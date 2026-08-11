/**
 * Direct upstream connectors for provider sites (no Upstream Hub).
 * Supports sub2api + newapi login, group rates, balance, and optional Turnstile solve.
 */
import { fromZonedTime } from "date-fns-tz";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";
import {
  getProviderSiteRateLimitCooldown,
  noteProviderSiteRateLimit,
} from "@/lib/provider-sites/rate-limit-cooldown";

export type SiteCaptchaProvider = "none" | "yescaptcha" | "capsolver" | "2captcha" | "anticaptcha";

export type UpstreamAuthSession = {
  accessToken?: string;
  cookie?: string;
  userId?: string;
  expiresAt: Date;
};

export type UpstreamGroupRate = {
  groupName: string;
  description: string | null;
  ratio: number;
  completionRatio: number;
};

export type UpstreamApiKey = {
  id: string;
  key: string;
  name: string;
  /** Upstream group name this key belongs to ("" = no resolvable binding). */
  groupName: string;
  /** How confidently the upstream reports this key's group binding. */
  groupBinding?: "bound" | "unbound" | "orphaned" | "unknown";
  status: string;
};

export type UpstreamBalanceSnapshot = {
  balance: number | null;
  todayCost: number | null;
  totalCost: number | null;
};

export type UpstreamSiteCredentials = {
  siteUrl: string;
  siteType: string;
  username: string;
  password: string;
  turnstileEnabled: boolean;
  captchaProvider: SiteCaptchaProvider | string;
  captchaApiKey: string | null;
  captchaEndpoint: string | null;
  session?: UpstreamAuthSession | null;
};

const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const execFileAsync = promisify(execFile);
const CURL_IMPERSONATE_BIN = "curl_chrome116";
const CURL_IMPERSONATE_ENABLED = !!process.env.ENABLE_CURL_IMPERSONATE;

/**
 * Minimal fetch-compatible response built from a curl-impersonate child process.
 * curl-impersonate mimics Chrome's TLS/HTTP2 fingerprint, which is required by
 * upstream sites whose Cloudflare WAF blocks non-browser clients (403 HTML on
 * valid tokens). Fall back to plain fetch when the binary is unavailable.
 */
async function impersonateFetch(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<Response> {
  const args = [
    "-sS",
    "--max-time",
    "30",
    "-w",
    "\n%{http_code}\n%{content_type}",
  ];
  const method = init.method ?? "GET";
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (k.toLowerCase() === "user-agent") continue; // wrapper 自带 Chrome UA
    args.push("-H", `${k}: ${v}`);
  }
  if (init.body != null) args.push("--data-raw", init.body);
  args.push(url);

  try {
    const { stdout } = await execFileAsync(CURL_IMPERSONATE_BIN, args, {
      timeout: 35_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = stdout.split("\n");
    const statusLine = lines[lines.length - 2]?.trim() ?? "0";
    const contentType = lines[lines.length - 1]?.trim() ?? "";
    const body = lines.slice(0, -2).join("\n");
    const status = Number.parseInt(statusLine, 10) || 0;
    return new Response(body, {
      status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    logger.warn("[provider-sites] curl-impersonate failed, falling back to fetch", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return fetch(url, { method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(30_000) });
  }
}

export class UpstreamRequestError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    method: string,
    path: string,
    status: number,
    body: string,
    retryAfterMs?: number | null
  ) {
    super(`upstream ${method} ${path} failed: ${status} ${body.slice(0, 200)}`);
    this.name = "UpstreamRequestError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

export function isUpstreamUnauthorizedError(error: unknown): boolean {
  // 401 = token rejected; 403 = account/session blocked by upstream WAF. Both
  // mean the persisted session is unusable, so trigger re-authentication.
  return (
    error instanceof UpstreamRequestError &&
    (error.status === 401 || error.status === 403)
  );
}

export function isUpstreamRateLimitedError(error: unknown): error is UpstreamRequestError {
  return error instanceof UpstreamRequestError && error.status === 429;
}

function trimSite(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function getCurrentDayTimestampRange(timezone: string): {
  startTimestamp: number;
  endTimestamp: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(nextDate.getUTCDate()).padStart(2, "0");
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const start = fromZonedTime(`${date}T00:00:00`, timezone).getTime();
  const end = fromZonedTime(`${nextYear}-${nextMonth}-${nextDay}T00:00:00`, timezone).getTime();
  return {
    startTimestamp: Math.floor(start / 1000),
    endTimestamp: Math.floor(end / 1000),
  };
}

function sumNewApiQuotaData(data: unknown): number | null {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : null;
  if (!rows) return null;
  return rows.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    return sum + toNumber((row as { quota?: unknown }).quota, 0);
  }, 0);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`invalid json from upstream (${res.status}): ${text.slice(0, 200)}`);
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function getRetryAfterMs(res: Response): number | null {
  return parseRetryAfterMs(res.headers.get("retry-after"));
}

function assertProviderSiteRateLimitAllowed(siteUrl: string, method: string, path: string): void {
  const cooldown = getProviderSiteRateLimitCooldown(siteUrl);
  if (!cooldown) return;
  throw new UpstreamRequestError(
    method,
    path,
    429,
    `rate limit cooldown active; retry in ${Math.ceil(cooldown.remainingMs / 1000)}s`,
    cooldown.remainingMs
  );
}

function joinCookies(setCookie: string | null, existing?: string): string {
  if (!setCookie) return existing ?? "";
  const parts = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean) as string[];
  const map = new Map<string, string>();
  for (const part of (existing ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function solveTurnstile(input: {
  provider: string;
  apiKey: string;
  endpoint?: string | null;
  siteKey: string;
  pageUrl: string;
}): Promise<string> {
  const provider = input.provider.toLowerCase();
  const base =
    input.endpoint?.trim() ||
    (provider === "capsolver"
      ? "https://api.capsolver.com"
      : provider === "2captcha"
        ? "https://api.2captcha.com"
        : provider === "anticaptcha"
          ? "https://api.anti-captcha.com"
          : "https://api.yescaptcha.com");

  const taskType =
    provider === "capsolver" ? "AntiTurnstileTaskProxyLess" : "TurnstileTaskProxyless";

  const createRes = await fetch(`${base.replace(/\/+$/, "")}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: input.apiKey,
      task: {
        type: taskType,
        websiteURL: input.pageUrl,
        websiteKey: input.siteKey,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const createBody = (await readJson(createRes)) as {
    errorId?: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: string | number;
  };
  if (createBody.errorId && createBody.errorId !== 0) {
    throw new Error(
      `captcha createTask failed: ${createBody.errorCode || createBody.errorDescription || "unknown"}`
    );
  }
  const taskId = createBody.taskId;
  if (taskId == null || taskId === "") {
    throw new Error("captcha createTask: missing taskId");
  }

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${base.replace(/\/+$/, "")}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: input.apiKey, taskId }),
      signal: AbortSignal.timeout(30_000),
    });
    const pollBody = (await readJson(pollRes)) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      status?: string;
      solution?: { token?: string; gRecaptchaResponse?: string };
    };
    if (pollBody.errorId && pollBody.errorId !== 0) {
      throw new Error(
        `captcha getTaskResult failed: ${pollBody.errorCode || pollBody.errorDescription || "unknown"}`
      );
    }
    if (pollBody.status === "ready") {
      const token = pollBody.solution?.token || pollBody.solution?.gRecaptchaResponse;
      if (!token) throw new Error("captcha ready but token empty");
      return token;
    }
  }
  throw new Error("captcha solve timeout");
}

async function getTurnstileSiteKey(siteUrl: string, siteType: string): Promise<string | null> {
  const site = trimSite(siteUrl);
  if (siteType === "newapi") {
    const res = await fetch(`${site}/api/status`, {
      headers: { Accept: "application/json", "User-Agent": UPSTREAM_USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await readJson(res)) as {
      data?: { turnstile_check?: boolean; turnstile_site_key?: string };
      turnstile_check?: boolean;
      turnstile_site_key?: string;
    };
    const data = body.data ?? body;
    if (!data.turnstile_check) return null;
    return data.turnstile_site_key?.trim() || null;
  }

  const res = await fetch(`${site}/api/v1/settings/public`, {
    headers: { Accept: "application/json", "User-Agent": UPSTREAM_USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const body = (await readJson(res)) as {
    data?: { turnstile_enabled?: boolean; turnstile_site_key?: string };
  };
  const data = body.data;
  if (!data?.turnstile_enabled) return null;
  return data.turnstile_site_key?.trim() || null;
}

/**
 * Mirror UH GetTurnstileSiteKey flow:
 * 1) Probe public settings (sub2api /api/v1/settings/public, newapi /api/status).
 * 2) Site Turnstile off / empty site key -> auto skip, never call captcha solver.
 * 3) Site Turnstile on -> solve only when captcha provider + api key are configured.
 *
 * Local `turnstileEnabled` is advisory only (UI preference); live site config wins.
 * Operator force-skip: set captchaProvider to "none" and leave api key empty — if the
 * site actually requires Turnstile, login will fail with a clear error.
 */
async function maybeSolveTurnstile(creds: UpstreamSiteCredentials): Promise<string | undefined> {
  const siteKey = await getTurnstileSiteKey(creds.siteUrl, creds.siteType);
  if (!siteKey) {
    // Public settings: captcha off (or no key) -> auto skip, same as UH returning "".
    return undefined;
  }

  if (!creds.captchaApiKey || creds.captchaProvider === "none") {
    throw new Error(
      "upstream site has Turnstile enabled but captcha provider/api key is not configured"
    );
  }

  return solveTurnstile({
    provider: creds.captchaProvider,
    apiKey: creds.captchaApiKey,
    endpoint: creds.captchaEndpoint,
    siteKey,
    pageUrl: trimSite(creds.siteUrl),
  });
}

function sessionStillValid(session?: UpstreamAuthSession | null): boolean {
  if (!session) return false;
  if (session.expiresAt.getTime() <= Date.now() + 60_000) return false;
  return Boolean(session.accessToken || session.cookie);
}

function parseAccessTokenExpiry(value: unknown, fallbackMs: number): Date {
  if (typeof value === "number" || typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
      const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      if (millis > Date.now()) return new Date(millis);
    }
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  }
  return new Date(fallbackMs);
}

async function refreshNewApiSession(
  creds: UpstreamSiteCredentials
): Promise<UpstreamAuthSession | null> {
  const previous = creds.session;
  if (creds.siteType !== "newapi" || !previous?.cookie) return null;

  const site = trimSite(creds.siteUrl);
  const path = "/api/user/auth/refresh";
  assertProviderSiteRateLimitAllowed(site, "POST", path);
  const res = await fetch(`${site}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Cookie: previous.cookie,
      Origin: site,
      Referer: `${site}/`,
      "User-Agent": UPSTREAM_USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(res);

  // Older NewAPI releases do not expose the dashboard refresh endpoint. In
  // that case, fall back to the password login path. A 429 is different: do
  // not immediately turn it into another login attempt and extend the limit.
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message || "")
        : typeof body === "string"
          ? body
          : "";
    if ([401, 403, 404, 405].includes(res.status)) return null;
    const retryAfterMs = getRetryAfterMs(res);
    if (res.status === 429) noteProviderSiteRateLimit(site, retryAfterMs);
    throw new UpstreamRequestError(
      "POST",
      path,
      res.status,
      detail || "empty response",
      retryAfterMs
    );
  }

  if (!body || typeof body !== "object" || (body as { success?: unknown }).success !== true) {
    return null;
  }

  const data = (
    body as {
      data?: {
        access_token?: string;
        access_expires_at?: number | string;
        id?: number | string;
        user?: { id?: number | string };
      };
    }
  ).data;
  const accessToken =
    typeof data?.access_token === "string" ? data.access_token.trim() || undefined : undefined;
  const cookie = joinCookies(res.headers.get("set-cookie"), previous.cookie);
  const rawUserId = data?.id ?? data?.user?.id ?? previous.userId;
  const userId = rawUserId != null ? String(rawUserId) : undefined;
  if (!accessToken && !cookie) return null;

  return {
    accessToken,
    cookie: cookie || undefined,
    userId,
    expiresAt: parseAccessTokenExpiry(data?.access_expires_at, Date.now() + 15 * 60_000),
  };
}

export async function loginUpstreamSite(
  creds: UpstreamSiteCredentials
): Promise<UpstreamAuthSession> {
  assertProviderSiteRateLimitAllowed(trimSite(creds.siteUrl), "POST", "/api/user/login");
  if (sessionStillValid(creds.session)) {
    return creds.session as UpstreamAuthSession;
  }
  if (creds.siteType === "newapi" && creds.session?.cookie) {
    const refreshed = await refreshNewApiSession(creds);
    if (refreshed) return refreshed;
  }
  if (!creds.username || !creds.password) {
    throw new Error("site username/password required for upstream login");
  }

  const site = trimSite(creds.siteUrl);
  const turnstileToken = await maybeSolveTurnstile(creds);

  if (creds.siteType === "newapi") {
    const url = new URL(`${site}/api/user/login`);
    if (turnstileToken) url.searchParams.set("turnstile", turnstileToken);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UPSTREAM_USER_AGENT,
      },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
    const body = (await readJson(res)) as {
      success?: boolean;
      message?: string;
      data?: {
        require_2fa?: boolean;
        access_token?: string;
        access_expires_at?: number | string;
        id?: number | string;
        user?: { id?: number | string };
      };
    } | null;
    if (res.status === 429) {
      const retryAfterMs = getRetryAfterMs(res);
      noteProviderSiteRateLimit(site, retryAfterMs);
      throw new UpstreamRequestError(
        "POST",
        "/api/user/login",
        res.status,
        body?.message || (body ? "" : "empty response"),
        retryAfterMs
      );
    }
    if (!res.ok || !body || body.success === false) {
      const detail = body?.message || `HTTP ${res.status}${body ? "" : " (empty response)"}`;
      throw new Error(`newapi login failed: ${detail}`);
    }
    if (body.data?.require_2fa) {
      throw new Error("newapi account requires 2FA; disable 2FA on monitoring accounts");
    }
    const accessToken =
      typeof body.data?.access_token === "string"
        ? body.data.access_token.trim() || undefined
        : undefined;
    const cookie = joinCookies(res.headers.get("set-cookie"));
    if (!accessToken && !cookie) throw new Error("newapi login: no access token or session cookie");
    const rawUserId = body.data?.id ?? body.data?.user?.id;
    const userId = rawUserId != null ? String(rawUserId) : "";
    if (!userId || userId === "0") throw new Error("newapi login: missing user id");
    return {
      accessToken,
      cookie: cookie || undefined,
      userId,
      expiresAt: parseAccessTokenExpiry(
        body.data?.access_expires_at,
        Date.now() + 7 * 24 * 3600_000
      ),
    };
  }

  const loginBody: Record<string, string> = {
    email: creds.username,
    password: creds.password,
  };
  if (turnstileToken) loginBody.turnstile_token = turnstileToken;
  const res = await (CURL_IMPERSONATE_ENABLED
    ? impersonateFetch(`${site}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginBody),
      })
    : fetch(`${site}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UPSTREAM_USER_AGENT,
        },
        body: JSON.stringify(loginBody),
        signal: AbortSignal.timeout(30_000),
      }));
  const body = (await readJson(res)) as {
    code?: number;
    message?: string;
    data?: { requires_2fa?: boolean; access_token?: string; expires_in?: number };
  };
  if (res.status === 429) {
    const retryAfterMs = getRetryAfterMs(res);
    noteProviderSiteRateLimit(site, retryAfterMs);
    throw new UpstreamRequestError(
      "POST",
      "/api/v1/auth/login",
      res.status,
      body?.message || "empty response",
      retryAfterMs
    );
  }
  if (!res.ok || (body.code != null && body.code !== 0)) {
    throw new Error(`sub2api login failed: ${body.message || res.status}`);
  }
  if (body.data?.requires_2fa) {
    throw new Error("sub2api account requires 2FA; disable 2FA on monitoring accounts");
  }
  const accessToken = body.data?.access_token;
  if (!accessToken) throw new Error("sub2api login: empty access_token");
  const expiresIn = body.data?.expires_in && body.data.expires_in > 0 ? body.data.expires_in : 3600;
  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

function applyNewApiAuth(headers: Record<string, string>, session: UpstreamAuthSession): void {
  if (!session.accessToken && !session.cookie) {
    throw new Error("missing newapi access token or session cookie");
  }
  // Current NewAPI uses the short-lived dashboard access token. Keep the
  // cookie + user header for older deployments that still use that contract.
  if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  if (session.cookie) headers.Cookie = session.cookie;
  if (session.userId) headers["New-Api-User"] = session.userId;
}

async function upstreamGetJson(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  path: string
): Promise<unknown> {
  const site = trimSite(creds.siteUrl);
  assertProviderSiteRateLimitAllowed(site, "GET", path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  if (creds.siteType === "newapi") {
    applyNewApiAuth(headers, session);
  } else {
    if (!session.accessToken) throw new Error("missing sub2api access_token");
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await (CURL_IMPERSONATE_ENABLED && creds.siteType === "sub2api"
    ? impersonateFetch(`${site}${path}`, { headers })
    : fetch(`${site}${path}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      }));
  if (!res.ok) {
    const text = await res.text();
    const retryAfterMs = getRetryAfterMs(res);
    if (res.status === 429) noteProviderSiteRateLimit(site, retryAfterMs);
    throw new UpstreamRequestError("GET", path, res.status, text, retryAfterMs);
  }
  const body = await readJson(res);
  if (creds.siteType === "newapi") {
    const wrapped = body as { success?: boolean; message?: string; data?: unknown };
    if (wrapped && typeof wrapped === "object" && "success" in wrapped) {
      if (wrapped.success === false) {
        throw new Error(`newapi ${path}: ${wrapped.message || "failed"}`);
      }
      return wrapped.data;
    }
  } else {
    const wrapped = body as { code?: number; message?: string; data?: unknown };
    if (wrapped && typeof wrapped === "object" && "code" in wrapped) {
      if (wrapped.code != null && wrapped.code !== 0) {
        throw new Error(`sub2api ${path}: ${wrapped.message || "failed"}`);
      }
      return wrapped.data ?? body;
    }
  }
  return body;
}

export async function fetchUpstreamGroupRates(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession
): Promise<UpstreamGroupRate[]> {
  if (creds.siteType === "newapi") {
    const data = (await upstreamGetJson(creds, session, "/api/user/self/groups")) as Record<
      string,
      { ratio?: unknown; desc?: string }
    >;
    const out: UpstreamGroupRate[] = [];
    for (const [name, value] of Object.entries(data || {})) {
      const ratio = toNumber(value?.ratio, Number.NaN);
      if (!Number.isFinite(ratio)) continue;
      out.push({
        groupName: name,
        description: value?.desc?.trim() || null,
        ratio,
        completionRatio: 0,
      });
    }
    return out.sort((a, b) => a.ratio - b.ratio || a.groupName.localeCompare(b.groupName));
  }

  const groups = (await upstreamGetJson(creds, session, "/api/v1/groups/available")) as Array<{
    id?: number | string;
    name?: string;
    description?: string;
    rate_multiplier?: number | string;
  }>;
  let overrides: Record<string, number> = {};
  try {
    const ratesBody = (await upstreamGetJson(creds, session, "/api/v1/groups/rates")) as Record<
      string,
      number | string
    >;
    overrides = Object.fromEntries(
      Object.entries(ratesBody || {}).map(([k, v]) => [k, toNumber(v, Number.NaN)])
    );
  } catch (error) {
    logger.warn("[provider-sites] groups/rates optional fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const out: UpstreamGroupRate[] = [];
  for (const g of groups || []) {
    const name = (g.name || "").trim();
    if (!name) continue;
    let ratio = toNumber(g.rate_multiplier, 1);
    const idKey = g.id != null ? String(g.id) : "";
    if (idKey && Number.isFinite(overrides[idKey])) {
      ratio = overrides[idKey];
    }
    out.push({
      groupName: name,
      description: g.description?.trim() || null,
      ratio,
      completionRatio: 0,
    });
  }
  return out.sort((a, b) => a.ratio - b.ratio || a.groupName.localeCompare(b.groupName));
}

export async function fetchUpstreamBalance(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  timezone = "UTC"
): Promise<UpstreamBalanceSnapshot> {
  if (creds.siteType === "newapi") {
    let quotaPerUnit = 500000;
    try {
      const statusRes = await fetch(`${trimSite(creds.siteUrl)}/api/status`, {
        headers: { Accept: "application/json", "User-Agent": UPSTREAM_USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      const statusBody = (await readJson(statusRes)) as {
        data?: { quota_per_unit?: number };
        quota_per_unit?: number;
      };
      const status = statusBody.data ?? statusBody;
      if (status.quota_per_unit && status.quota_per_unit > 0) {
        quotaPerUnit = status.quota_per_unit;
      }
    } catch {
      // keep default
    }
    const self = (await upstreamGetJson(creds, session, "/api/user/self")) as {
      quota?: number;
      used_quota?: number;
    };
    let todayCost: number | null = null;
    try {
      const { startTimestamp, endTimestamp } = getCurrentDayTimestampRange(timezone);
      const data = await upstreamGetJson(
        creds,
        session,
        `/api/data/self?start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}`
      );
      const quota = sumNewApiQuotaData(data);
      todayCost = quota == null ? null : quota / quotaPerUnit;
    } catch (error) {
      if (isUpstreamUnauthorizedError(error)) throw error;
      logger.debug("[provider-sites] newapi daily usage fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      balance: toNumber(self.quota, 0) / quotaPerUnit,
      todayCost,
      totalCost: toNumber(self.used_quota, 0) / quotaPerUnit,
    };
  }

  const me = (await upstreamGetJson(creds, session, "/api/v1/auth/me")) as {
    balance?: number;
  };
  let todayCost: number | null = null;
  let totalCost: number | null = null;
  try {
    const stats = (await upstreamGetJson(creds, session, "/api/v1/usage/dashboard/stats")) as {
      today_actual_cost?: number;
      total_actual_cost?: number;
    };
    todayCost = toNumber(stats.today_actual_cost, 0);
    totalCost = toNumber(stats.total_actual_cost, 0);
  } catch {
    // optional
  }
  return {
    balance: toNumber(me.balance, 0),
    todayCost,
    totalCost,
  };
}

async function upstreamPostJson(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  path: string,
  payload?: unknown
): Promise<unknown> {
  const site = trimSite(creds.siteUrl);
  assertProviderSiteRateLimitAllowed(site, "POST", path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (creds.siteType === "newapi") {
    applyNewApiAuth(headers, session);
  } else {
    if (!session.accessToken) throw new Error("missing sub2api access_token");
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await (CURL_IMPERSONATE_ENABLED && creds.siteType === "sub2api"
    ? impersonateFetch(`${site}${path}`, {
        method: "POST",
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
    : fetch(`${site}${path}`, {
        method: "POST",
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      }));
  if (!res.ok) {
    const text = await res.text();
    const retryAfterMs = getRetryAfterMs(res);
    if (res.status === 429) noteProviderSiteRateLimit(site, retryAfterMs);
    throw new UpstreamRequestError("POST", path, res.status, text, retryAfterMs);
  }
  const body = await readJson(res);
  if (creds.siteType === "newapi") {
    const wrapped = body as { success?: boolean; message?: string; data?: unknown };
    if (wrapped && typeof wrapped === "object" && "success" in wrapped) {
      if (wrapped.success === false) {
        throw new Error(`newapi ${path}: ${wrapped.message || "failed"}`);
      }
      return wrapped.data;
    }
  }
  // sub2api write envelope: { code: 0, data: ... }
  if (creds.siteType !== "newapi" && body && typeof body === "object" && "code" in body) {
    const wrapped = body as { code?: number; message?: string; data?: unknown };
    if (wrapped.code != null && wrapped.code !== 0) {
      throw new Error(`sub2api ${path}: ${wrapped.message || `code ${wrapped.code}`}`);
    }
    if ("data" in wrapped) return wrapped.data;
  }
  return body;
}

async function upstreamDeleteJson(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  path: string
): Promise<unknown> {
  const site = trimSite(creds.siteUrl);
  assertProviderSiteRateLimitAllowed(site, "DELETE", path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  if (creds.siteType === "newapi") {
    applyNewApiAuth(headers, session);
  } else {
    if (!session.accessToken) throw new Error("missing sub2api access_token");
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await (CURL_IMPERSONATE_ENABLED && creds.siteType === "sub2api"
    ? impersonateFetch(`${site}${path}`, { method: "DELETE", headers })
    : fetch(`${site}${path}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(30_000),
      }));
  if (!res.ok) {
    const text = await res.text();
    const retryAfterMs = getRetryAfterMs(res);
    if (res.status === 429) noteProviderSiteRateLimit(site, retryAfterMs);
    throw new UpstreamRequestError("DELETE", path, res.status, text, retryAfterMs);
  }
  const body = await readJson(res);
  if (creds.siteType === "newapi") {
    const wrapped = body as { success?: boolean; message?: string; data?: unknown };
    if (wrapped && typeof wrapped === "object" && "success" in wrapped) {
      if (wrapped.success === false) {
        throw new Error(`newapi ${path}: ${wrapped.message || "failed"}`);
      }
      return wrapped.data;
    }
  } else if (body && typeof body === "object" && "code" in body) {
    const wrapped = body as { code?: number; message?: string; data?: unknown };
    if (wrapped.code != null && wrapped.code !== 0) {
      throw new Error(`sub2api ${path}: ${wrapped.message || `code ${wrapped.code}`}`);
    }
    return "data" in wrapped ? wrapped.data : body;
  }
  return body;
}

/** Delete one active API key from the upstream site by its upstream ID. */
export async function deleteUpstreamApiKey(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  keyId: string | number
): Promise<void> {
  const id = String(keyId).trim();
  if (!id) throw new Error("upstream api key id is empty");

  if (creds.siteType === "newapi") {
    await upstreamDeleteJson(creds, session, `/api/token/${encodeURIComponent(id)}`);
    return;
  }
  if (creds.siteType === "sub2api") {
    await upstreamDeleteJson(creds, session, `/api/v1/keys/${encodeURIComponent(id)}`);
    return;
  }
  throw new Error(`unsupported upstream site type for key deletion: ${creds.siteType}`);
}

function isUsableUpstreamKey(key: string | null | undefined): boolean {
  const raw = (key ?? "").trim();
  if (!raw) return false;
  if (raw.includes("*") || raw.includes("...") || raw.includes("…")) return false;
  return raw.length > 12;
}

function stableAutoKeyName(groupName: string): string {
  // Short ASCII name so NewAPI/Sub2API name limits never trip; stable across retries.
  let hash = 0;
  const src = `cch-auto:${groupName}`;
  for (let i = 0; i < src.length; i += 1) {
    hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
  }
  return `cch-${hash.toString(16).padStart(8, "0").slice(0, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create one upstream API key for a group that currently has none.
 * - newapi: POST /api/token/ (unlimited, never expires) then re-list + reveal
 * - sub2api: POST /api/v1/keys with group_id resolved from groups/available
 *
 * Returns null on unsupported type / permission failure so caller can skip and
 * retry on the next 30-minute tick without aborting the whole site sync.
 */
export async function createUpstreamApiKey(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  input: { groupName: string; groupId?: string | number | null }
): Promise<UpstreamApiKey | null> {
  const groupName = input.groupName.trim();
  if (!groupName) return null;
  const name = stableAutoKeyName(groupName);
  const siteType = (creds.siteType || "sub2api").toLowerCase();

  try {
    if (siteType === "newapi") {
      await upstreamPostJson(creds, session, "/api/token/", {
        name,
        group: groupName,
        remain_quota: 0,
        unlimited_quota: true,
        expired_time: -1,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        cross_group_retry: false,
      });
    } else if (siteType === "sub2api") {
      let groupId = input.groupId ?? null;
      if (groupId == null) {
        const groups = (await upstreamGetJson(
          creds,
          session,
          "/api/v1/groups/available"
        )) as Array<{
          id?: number | string;
          name?: string;
        }>;
        const hit = (groups ?? []).find((g) => (g.name ?? "").trim() === groupName);
        if (hit?.id == null) {
          logger.warn("[provider-sites] create key: sub2api group id not found", { groupName });
          return null;
        }
        groupId = hit.id;
      }
      await upstreamPostJson(creds, session, "/api/v1/keys", {
        name,
        group_id: groupId,
        ip_whitelist: [],
        ip_blacklist: [],
      });
    } else {
      logger.warn("[provider-sites] create key: unsupported site type", { siteType, groupName });
      return null;
    }
  } catch (error) {
    logger.warn("[provider-sites] create upstream key failed; will retry next tick", {
      groupName,
      siteType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Create responses often omit the full secret (esp. NewAPI). Re-list + reveal.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(700);
    try {
      const keys = await fetchUpstreamApiKeys(creds, session);
      const sameGroup = keys.filter((k) => k.groupName.trim() === groupName);
      const byName = sameGroup.filter((k) => k.name === name);
      const candidates = (byName.length > 0 ? byName : sameGroup).sort((a, b) => {
        const ai = Number(a.id) || 0;
        const bi = Number(b.id) || 0;
        return bi - ai;
      });
      const usable = candidates.find((k) => isUsableUpstreamKey(k.key));
      if (usable) {
        logger.info("[provider-sites] created upstream key", {
          groupName,
          name,
          id: usable.id,
          siteType,
        });
        return usable;
      }
    } catch (error) {
      logger.warn("[provider-sites] re-list after create failed", {
        groupName,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn("[provider-sites] create key ok but no usable secret after re-list", {
    groupName,
    name,
    siteType,
  });
  return null;
}

/**
 * List the monitoring account's upstream API keys (tokens).
 * sub2api: GET /api/v1/keys (paged, group name resolved via groups/available).
 * newapi:  GET /api/token/ (paged, group name is the token's `group` field).
 * Only "enabled"/active keys are returned. Pages are capped to avoid runaway loops.
 */
export async function fetchUpstreamApiKeys(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession
): Promise<UpstreamApiKey[]> {
  const MAX_PAGES = 10;
  const PAGE_SIZE = 100;
  const out: UpstreamApiKey[] = [];

  if (creds.siteType === "newapi") {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = (await upstreamGetJson(
        creds,
        session,
        `/api/token/?p=${page}&page_size=${PAGE_SIZE}`
      )) as {
        items?: Array<{
          id?: number | string;
          key?: string;
          name?: string;
          group?: string;
          status?: number | string;
        }>;
        pages?: number;
      };
      const items = data?.items ?? [];
      for (const item of items) {
        const key = (item.key ?? "").trim();
        if (!key) continue;
        // newapi token status: 1 = enabled
        const status = typeof item.status === "number" ? item.status : toNumber(item.status, 1);
        if (status !== 1) continue;
        out.push({
          id: String(item.id ?? key.slice(-8)),
          key,
          name: (item.name ?? "").trim(),
          groupName: (item.group ?? "").trim(),
          groupBinding: (item.group ?? "").trim() ? "bound" : "unbound",
          status: "enabled",
        });
      }
      const pages = toNumber(data?.pages, 1);
      if (page >= pages) break;
    }

    // newapi masks keys in list responses ("abcd****wxyz"); reveal them one by one.
    // A 429 means the upstream rate limit is engaged: stop the batch instead of
    // hammering the remaining tokens (each tick would otherwise re-extend the
    // window). The masked keys stay masked; isUsableKey() keeps them from
    // overwriting full keys already in CCH.
    for (const k of out) {
      if (!k.key.includes("*") || !/^\d+$/.test(k.id)) continue;
      try {
        const revealed = (await upstreamPostJson(creds, session, `/api/token/${k.id}/key`)) as {
          key?: string;
        };
        const full = (revealed?.key ?? "").trim();
        if (full && !full.includes("*")) k.key = full;
      } catch (error) {
        if (error instanceof UpstreamRequestError && error.status === 429) {
          logger.warn("[provider-sites] newapi reveal key rate-limited; skipping rest of batch", {
            id: k.id,
          });
          break;
        }
        logger.warn("[provider-sites] newapi reveal key failed", {
          id: k.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  // sub2api: group name needs the groups/available map (group_id -> name)
  const groupNameById = new Map<string, string>();
  let groupMapTrusted = false;
  try {
    const groups = (await upstreamGetJson(creds, session, "/api/v1/groups/available")) as Array<{
      id?: number | string;
      name?: string;
    }>;
    for (const g of groups ?? []) {
      if (g.id != null && g.name) groupNameById.set(String(g.id), g.name.trim());
    }
    // An empty map may be a transient/incomplete upstream response. Only use
    // missing IDs as evidence of an orphaned group when the map is non-empty.
    groupMapTrusted = groupNameById.size > 0;
  } catch (error) {
    logger.warn("[provider-sites] key sync: group map fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = (await upstreamGetJson(
      creds,
      session,
      `/api/v1/keys?page=${page}&page_size=${PAGE_SIZE}`
    )) as {
      items?: Array<{
        id?: number | string;
        key?: string;
        name?: string;
        group_id?: number | string | null;
        group?: { name?: string } | null;
        status?: string;
      }>;
      pages?: number;
    };
    const items = data?.items ?? [];
    for (const item of items) {
      const key = (item.key ?? "").trim();
      if (!key) continue;
      const status = (item.status ?? "").toLowerCase();
      if (status && status !== "enabled" && status !== "active") continue;
      const groupName =
        (item.group?.name ?? "").trim() ||
        (item.group_id != null ? (groupNameById.get(String(item.group_id)) ?? "") : "");
      const hasGroupId = item.group_id != null && String(item.group_id).trim() !== "";
      const groupBinding = groupName
        ? "bound"
        : hasGroupId
          ? groupMapTrusted && !groupNameById.has(String(item.group_id))
            ? "orphaned"
            : "unknown"
          : "unbound";
      out.push({
        id: String(item.id ?? key.slice(-8)),
        key,
        name: (item.name ?? "").trim(),
        groupName,
        groupBinding,
        status: "enabled",
      });
    }
    const pages = toNumber(data?.pages, 1);
    if (page >= pages) break;
  }
  return out;
}
