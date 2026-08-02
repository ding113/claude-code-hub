/**
 * Direct upstream connectors for provider sites (no Upstream Hub).
 * Supports sub2api + newapi login, group rates, balance, and optional Turnstile solve.
 */
import { fromZonedTime } from "date-fns-tz";
import { logger } from "@/lib/logger";

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
  /** Upstream group name this key belongs to ("" = unknown/unassigned). */
  groupName: string;
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

const UPSTREAM_USER_AGENT = "Claude-Code-Hub/provider-site-sync";

export class UpstreamRequestError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;

  constructor(method: string, path: string, status: number, body: string) {
    super(`upstream ${method} ${path} failed: ${status} ${body.slice(0, 200)}`);
    this.name = "UpstreamRequestError";
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

export function isUpstreamUnauthorizedError(error: unknown): boolean {
  return error instanceof UpstreamRequestError && error.status === 401;
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

export async function loginUpstreamSite(
  creds: UpstreamSiteCredentials
): Promise<UpstreamAuthSession> {
  if (sessionStillValid(creds.session)) {
    return creds.session as UpstreamAuthSession;
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
      data?: { require_2fa?: boolean; id?: number };
    };
    if (!res.ok || body.success === false) {
      throw new Error(`newapi login failed: ${body.message || res.status}`);
    }
    if (body.data?.require_2fa) {
      throw new Error("newapi account requires 2FA; disable 2FA on monitoring accounts");
    }
    const cookie = joinCookies(res.headers.get("set-cookie"));
    if (!cookie) throw new Error("newapi login: no session cookie");
    const userId = body.data?.id != null ? String(body.data.id) : undefined;
    if (!userId) throw new Error("newapi login: missing user id");
    return {
      cookie,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    };
  }

  const loginBody: Record<string, string> = {
    email: creds.username,
    password: creds.password,
  };
  if (turnstileToken) loginBody.turnstile_token = turnstileToken;
  const res = await fetch(`${site}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UPSTREAM_USER_AGENT,
    },
    body: JSON.stringify(loginBody),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await readJson(res)) as {
    code?: number;
    message?: string;
    data?: { requires_2fa?: boolean; access_token?: string; expires_in?: number };
  };
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

async function upstreamGetJson(
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession,
  path: string
): Promise<unknown> {
  const site = trimSite(creds.siteUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  if (creds.siteType === "newapi") {
    if (!session.cookie) throw new Error("missing newapi cookie");
    headers.Cookie = session.cookie;
    if (session.userId) headers["New-Api-User"] = session.userId;
  } else {
    if (!session.accessToken) throw new Error("missing sub2api access_token");
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await fetch(`${site}${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamRequestError("GET", path, res.status, text);
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
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (creds.siteType === "newapi") {
    if (!session.cookie) throw new Error("missing newapi cookie");
    headers.Cookie = session.cookie;
    if (session.userId) headers["New-Api-User"] = session.userId;
  } else {
    if (!session.accessToken) throw new Error("missing sub2api access_token");
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await fetch(`${site}${path}`, {
    method: "POST",
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamRequestError("POST", path, res.status, text);
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
 * retry on the next 5-minute tick without aborting the whole site sync.
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
          status: "enabled",
        });
      }
      const pages = toNumber(data?.pages, 1);
      if (page >= pages) break;
    }

    // newapi masks keys in list responses ("abcd****wxyz"); reveal them one by one.
    for (const k of out) {
      if (!k.key.includes("*") || !/^\d+$/.test(k.id)) continue;
      try {
        const revealed = (await upstreamPostJson(creds, session, `/api/token/${k.id}/key`)) as {
          key?: string;
        };
        const full = (revealed?.key ?? "").trim();
        if (full && !full.includes("*")) k.key = full;
      } catch (error) {
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
  try {
    const groups = (await upstreamGetJson(creds, session, "/api/v1/groups/available")) as Array<{
      id?: number | string;
      name?: string;
    }>;
    for (const g of groups ?? []) {
      if (g.id != null && g.name) groupNameById.set(String(g.id), g.name.trim());
    }
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
      out.push({
        id: String(item.id ?? key.slice(-8)),
        key,
        name: (item.name ?? "").trim(),
        groupName,
        status: "enabled",
      });
    }
    const pages = toNumber(data?.pages, 1);
    if (page >= pages) break;
  }
  return out;
}
