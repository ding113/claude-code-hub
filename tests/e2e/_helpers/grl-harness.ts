import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";

/**
 * Shared harness for the group-rate-limit end-to-end scenarios
 * (`tests/e2e/group-rate-limit-scenarios-live.test.ts`).
 *
 * The suite drives a *running* server (the production guard pipeline) and
 * observes three orthogonal effects that no unit test can prove together:
 *   1. the Admin REST surface provisions model groups / user groups / limits /
 *      quota boosts and the resolver snapshot picks them up;
 *   2. the proxy hot path enforces the resolved buckets (HTTP rejection); and
 *   3. complete split writes `counted_in_*_global` onto `usage_ledger`.
 *
 * Everything is gated on env so the suite is skipped in CI / unit runs:
 *   GRL_E2E_BASE_URL     proxy + Admin API origin, e.g. http://localhost:23000
 *   GRL_E2E_ADMIN_TOKEN  admin bearer token (falls back to ADMIN_TOKEN)
 *   GRL_E2E_DSN          Postgres DSN the server writes to (falls back to DSN)
 * Optional:
 *   GRL_E2E_REAL_MODEL       a model that routes to a live provider (default glm-4.7);
 *                            used only by the split scenarios that need a billed 200.
 *   GRL_E2E_REDIS_CONTAINER  docker container name running the server's Redis
 *                            (default claude-code-hub-redis-1); enables a
 *                            best-effort lease snapshot read via `docker exec`.
 */

const execFileAsync = promisify(execFile);

export const BASE_URL = (process.env.GRL_E2E_BASE_URL ?? "").replace(/\/+$/, "");
export const ADMIN_TOKEN = process.env.GRL_E2E_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? "";
export const DSN = process.env.GRL_E2E_DSN ?? process.env.DSN ?? "";
export const REAL_MODEL = process.env.GRL_E2E_REAL_MODEL ?? "glm-4.7";
export const REDIS_CONTAINER = process.env.GRL_E2E_REDIS_CONTAINER ?? "claude-code-hub-redis-1";

/** The suite only runs when all three transports are configured. */
export const HARNESS_READY = Boolean(BASE_URL && ADMIN_TOKEN && DSN);

// A short, unique-ish tag so concurrent runs / leftover rows never collide.
export const RUN_ID = `e2e-grl-${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Admin REST API
// ---------------------------------------------------------------------------

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: parsed as T };
}

// ---------------------------------------------------------------------------
// Proxy hot path
// ---------------------------------------------------------------------------

export interface ProxyOutcome {
  status: number;
  /** Raw response body text (kept for the report). */
  raw: string;
  /** Parsed `error.message` when present. */
  message: string;
  /** Parsed `error.code` / `error.type` when present. */
  code: string;
  /** Classified outcome of the request. */
  kind: "limit_block" | "passed_upstream_unavailable" | "success" | "other";
}

const LIMIT_BLOCK_RE = /额度超限|额度已超|超出限制|exceeded|quota|rate.?limit/i;
const PROVIDER_UNAVAILABLE_RE =
  /no_available_providers|service_unavailable|供应商暂时不可用|no available providers/i;

export async function proxy(
  model: string,
  apiKey: string,
  opts: { timeoutMs?: number; maxTokens?: number; prompt?: string } = {}
): Promise<ProxyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45000);
  try {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          // Default: a tiny, cheap probe (enforcement scenarios don't need cost).
          // Billing scenarios pass a larger maxTokens/prompt to force a priced response.
          max_tokens: opts.maxTokens ?? 16,
          messages: [{ role: "user", content: opts.prompt ?? "ping" }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      // A live-provider timeout / transient network error is not a verdict on
      // the limit; surface it as a retryable non-result so pollUntil continues.
      return {
        status: 0,
        raw: err instanceof Error ? err.message : String(err),
        message: "",
        code: "transport_error",
        kind: "other",
      };
    }
    const raw = await res.text();
    let message = "";
    let code = "";
    try {
      const json = JSON.parse(raw) as {
        error?: { message?: string; code?: string; type?: string };
      };
      message = json.error?.message ?? "";
      code = json.error?.code ?? json.error?.type ?? "";
    } catch {
      /* non-JSON body */
    }

    let kind: ProxyOutcome["kind"] = "other";
    if (res.status === 200) {
      kind = "success";
    } else if (PROVIDER_UNAVAILABLE_RE.test(message) || PROVIDER_UNAVAILABLE_RE.test(code)) {
      // Guard let the request through; the synthetic model simply has no provider.
      kind = "passed_upstream_unavailable";
    } else if (LIMIT_BLOCK_RE.test(message) || res.status === 402 || res.status === 429) {
      kind = "limit_block";
    }
    return { status: res.status, raw, message, code, kind };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Postgres observation + seeding
// ---------------------------------------------------------------------------

let sqlClient: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!sqlClient) {
    sqlClient = postgres(DSN, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  }
  return sqlClient;
}

export async function closeSql() {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
  }
}

export interface LedgerRow {
  id: number;
  user_id: number;
  key: string;
  model: string;
  cost_usd: string;
  counted_in_user_global: boolean;
  counted_in_key_global: boolean;
  created_at: Date;
}

/** Highest ledger id for a (user, model) pair — used to detect freshly-written rows. */
export async function maxLedgerId(userId: number, model: string): Promise<number> {
  const rows = await sql()<{ max: number | null }[]>`
    SELECT MAX(id) AS max FROM usage_ledger WHERE user_id = ${userId} AND model = ${model}`;
  return Number(rows[0]?.max ?? 0);
}

/** The newest ledger row for a (user, model) pair strictly newer than `afterId`. */
export async function newerLedgerRow(
  userId: number,
  model: string,
  afterId: number
): Promise<LedgerRow | null> {
  const rows = await sql()<LedgerRow[]>`
    SELECT id, user_id, key, model, cost_usd,
           counted_in_user_global, counted_in_key_global, created_at
    FROM usage_ledger
    WHERE user_id = ${userId} AND model = ${model} AND id > ${afterId}
    ORDER BY id DESC LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * Seed a billable ledger row so the model bucket re-seeds from DB with a known
 * usage. `blocked_by IS NULL` + `endpoint IS NULL` keeps it inside
 * LEDGER_BILLING_CONDITION. `request_id` carries a UNIQUE index and there is no
 * FK on it, so we use a run-local negative sentinel that cannot collide with the
 * positive request_id sequence nor with other seeds.
 */
const REQ_SENTINEL_BASE = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let reqSentinelSeq = 0;

export async function seedLedger(params: {
  userId: number;
  key: string;
  model: string;
  costUsd: number;
  countedUser?: boolean;
  countedKey?: boolean;
  /** Override the row timestamp. Defaults to now(). Used to place usage in a past
   * window (e.g. weekly-but-not-today) so per-window resolution can be observed. */
  createdAt?: Date;
}): Promise<number> {
  const requestId = -(REQ_SENTINEL_BASE + reqSentinelSeq++);
  const createdAt = params.createdAt ?? null;
  const rows = await sql()<{ id: number }[]>`
    INSERT INTO usage_ledger
      (request_id, user_id, key, provider_id, final_provider_id, model, endpoint,
       is_success, blocked_by, cost_usd, counted_in_user_global, counted_in_key_global, created_at)
    VALUES
      (${requestId}, ${params.userId}, ${params.key}, 1, 1, ${params.model}, NULL,
       true, NULL, ${params.costUsd}, ${params.countedUser ?? true}, ${params.countedKey ?? true},
       ${createdAt ?? sql()`now()`})
    RETURNING id`;
  return rows[0].id;
}

/** Remove every ledger row this run created (seeds + real billed rows). */
export async function cleanupLedger(userIds: number[], models: string[]): Promise<void> {
  if (userIds.length === 0 && models.length === 0) return;
  if (userIds.length > 0) {
    await sql()`DELETE FROM usage_ledger WHERE user_id IN ${sql()(userIds)}`;
  }
  if (models.length > 0) {
    await sql()`DELETE FROM usage_ledger WHERE model IN ${sql()(models)}`;
  }
}

/**
 * Hard-purge the run's test users. The Admin DELETE is a soft delete (the row
 * survives, disabled), so we follow up with a direct delete to keep the DB
 * pristine. Only `quota_boost_grants` FKs users (ON DELETE CASCADE); `keys` has
 * no FK, so its rows are removed explicitly first.
 */
export async function hardPurgeUsers(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  await sql()`DELETE FROM keys WHERE user_id IN ${sql()(userIds)}`;
  await sql()`DELETE FROM users WHERE id IN ${sql()(userIds)}`;
}

/**
 * Drive the real billed model until a freshly-written ledger row satisfies
 * `predicate` (i.e. the split flag settled to the expected value), tolerating a
 * flaky live upstream. The ledger row is committed slightly after the HTTP
 * response, so each success is followed by a short settle-poll of the DB.
 *
 * Returns `anySuccess=false` when the upstream never returned 200 across all
 * attempts — the caller skips (a provider outage is not a code verdict).
 */
export async function billUntilFlag(params: {
  userId: number;
  key: string;
  model: string;
  afterId: number;
  predicate: (row: LedgerRow) => boolean;
  tries?: number;
  reqTimeoutMs?: number;
  maxMs?: number;
  maxTokens?: number;
  prompt?: string;
}): Promise<{ anySuccess: boolean; row: LedgerRow | null }> {
  const tries = params.tries ?? 30;
  const deadline = Date.now() + (params.maxMs ?? 150_000);
  let anySuccess = false;
  let lastRow: LedgerRow | null = null;
  for (let i = 0; i < tries && Date.now() < deadline; i++) {
    const out = await proxy(params.model, params.key, {
      timeoutMs: params.reqTimeoutMs ?? 25000,
      maxTokens: params.maxTokens,
      prompt: params.prompt,
    });
    if (out.kind === "success") {
      anySuccess = true;
      // The billing/ledger write trails the response; settle-poll the DB.
      for (let j = 0; j < 10; j++) {
        const row = await newerLedgerRow(params.userId, params.model, params.afterId);
        if (row) {
          lastRow = row;
          if (params.predicate(row)) return { anySuccess, row };
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return { anySuccess, row: lastRow };
}

// ---------------------------------------------------------------------------
// Best-effort Redis lease snapshot (short TTL; supplementary evidence only)
// ---------------------------------------------------------------------------

export async function readUserMgLeases(
  userId: number,
  groupId: number
): Promise<Record<string, unknown>[]> {
  try {
    const { stdout: keysOut } = await execFileAsync("docker", [
      "exec",
      REDIS_CONTAINER,
      "redis-cli",
      "--scan",
      "--pattern",
      `lease:user-mg:${userId}:${groupId}:*`,
    ]);
    const keys = keysOut
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    const leases: Record<string, unknown>[] = [];
    for (const key of keys) {
      const { stdout } = await execFileAsync("docker", [
        "exec",
        REDIS_CONTAINER,
        "redis-cli",
        "GET",
        key,
      ]);
      const val = stdout.trim();
      if (val) {
        try {
          leases.push({ key, ...(JSON.parse(val) as Record<string, unknown>) });
        } catch {
          /* ignore */
        }
      }
    }
    return leases;
  } catch {
    return []; // docker not available — caller treats as "no supplementary data"
  }
}

// ---------------------------------------------------------------------------
// Redis container control (fail-open / outage scenarios). The server's Redis is
// a local dev container, so a brief stop is acceptable. `docker stop` cleanly
// closes the socket (ioredis status leaves "ready"), unlike `docker pause` which
// freezes the process and makes clients hang.
// ---------------------------------------------------------------------------

export async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["inspect", REDIS_CONTAINER, "--format", "{{.Id}}"]);
    return true;
  } catch {
    return false;
  }
}

export async function redisStop(): Promise<void> {
  await execFileAsync("docker", ["stop", REDIS_CONTAINER]);
}

export async function redisStartAndWait(): Promise<void> {
  await execFileAsync("docker", ["start", REDIS_CONTAINER]);
  // Wait until the container answers PING again so later work isn't degraded.
  for (let i = 0; i < 30; i++) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "exec",
        REDIS_CONTAINER,
        "redis-cli",
        "PING",
      ]);
      if (stdout.trim() === "PONG") return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------------------------------------------------------------------------
// Polling helper — absorbs the resolver snapshot's stale-while-revalidate lag
// ---------------------------------------------------------------------------

export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { tries?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const tries = opts.tries ?? 25;
  const delayMs = opts.delayMs ?? 700;
  let last: T | undefined;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `pollUntil timed out${opts.label ? ` [${opts.label}]` : ""} after ${tries} tries; last=${JSON.stringify(last)}`
  );
}

// ---------------------------------------------------------------------------
// Entity lifecycle helpers (create + remember for teardown)
// ---------------------------------------------------------------------------

export interface Teardown {
  add(fn: () => Promise<void>): void;
  run(): Promise<void>;
}

export function createTeardown(): Teardown {
  const fns: (() => Promise<void>)[] = [];
  return {
    add(fn) {
      fns.push(fn);
    },
    async run() {
      // reverse order: dependents before dependencies
      for (const fn of fns.reverse()) {
        try {
          await fn();
        } catch (err) {
          // best-effort cleanup; surface but don't fail teardown
          console.warn("teardown step failed:", err instanceof Error ? err.message : err);
        }
      }
    },
  };
}

export async function createModelGroup(name: string, teardown: Teardown): Promise<number> {
  const res = await api<{ id: number }>("POST", "/api/v1/model-groups", { name });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create model-group failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.id;
  teardown.add(async () => {
    await api("DELETE", `/api/v1/model-groups/${id}`);
  });
  return id;
}

export async function addModelGroupMember(groupId: number, model: string): Promise<void> {
  const res = await api("POST", `/api/v1/model-groups/${groupId}/members`, { model });
  if (res.status !== 204 && res.status !== 200 && res.status !== 201) {
    throw new Error(`add member failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function createUserGroup(tag: string, teardown: Teardown): Promise<number> {
  const res = await api<{ id: number }>("POST", "/api/v1/user-groups", { tag, name: tag });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create user-group failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.id;
  teardown.add(async () => {
    await api("DELETE", `/api/v1/user-groups/${id}`);
  });
  return id;
}

export interface LimitCaps {
  dailyLimitUsd?: number;
  limit5hUsd?: number;
  limitWeeklyUsd?: number;
  limitMonthlyUsd?: number;
  limitTotalUsd?: number;
}

export async function createModelLimit(
  subjectType: "user" | "key" | "user_group",
  subjectId: number,
  modelGroupId: number,
  caps: LimitCaps,
  teardown: Teardown
): Promise<number> {
  const res = await api<{ id: number }>("POST", "/api/v1/model-limits", {
    subjectType,
    subjectId,
    modelGroupId,
    ...caps,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`create model-limit failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.id;
  teardown.add(async () => {
    await api("DELETE", `/api/v1/model-limits/${id}`);
  });
  return id;
}

export interface TestUser {
  id: number;
  key: string;
}

export async function createUser(
  name: string,
  opts: { tags?: string[]; dailyQuota?: number | null; rpm?: number | null },
  teardown: Teardown
): Promise<TestUser> {
  const res = await api<{ user: { id: number }; defaultKey: { key: string } }>(
    "POST",
    "/api/v1/users",
    {
      name,
      tags: opts.tags ?? [],
      ...(opts.dailyQuota !== undefined ? { dailyQuota: opts.dailyQuota } : {}),
      ...(opts.rpm !== undefined ? { rpm: opts.rpm } : {}),
    }
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.user.id;
  const key = res.body.defaultKey.key;
  teardown.add(async () => {
    await api("DELETE", `/api/v1/users/${id}`);
  });
  return { id, key };
}

/** Create an additional API key (optionally with its own daily cost limit). */
export async function createKey(
  userId: number,
  name: string,
  opts: { limitDailyUsd?: number },
  teardown: Teardown
): Promise<{ id: number; key: string }> {
  const res = await api<{ id: number; generatedKey?: string; key?: string }>(
    "POST",
    `/api/v1/users/${userId}/keys`,
    { name, ...(opts.limitDailyUsd != null ? { limitDailyUsd: opts.limitDailyUsd } : {}) }
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create key failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.id;
  const key = res.body.generatedKey ?? res.body.key ?? "";
  teardown.add(async () => {
    await api("DELETE", `/api/v1/keys/${id}`);
  });
  return { id, key };
}

export async function createQuotaBoost(
  params: {
    userId: number;
    modelGroupId: number;
    window: "5h" | "daily" | "weekly" | "monthly" | "total";
    amountUsd: number;
    validFrom: string;
    validTo: string;
  },
  teardown: Teardown
): Promise<number> {
  const res = await api<{ id: number }>("POST", "/api/v1/quota-boosts", params);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create quota-boost failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.id;
  teardown.add(async () => {
    await api("DELETE", `/api/v1/quota-boosts/${id}`);
  });
  return id;
}

/** ISO-8601 with explicit offset (the create schema rejects bare local time). */
export function isoOffset(date: Date): string {
  return date.toISOString().replace("Z", "+00:00");
}
