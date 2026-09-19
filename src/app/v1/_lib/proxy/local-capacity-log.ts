import type { Context } from "hono";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { getMemoryGovernor } from "@/lib/memory/governor";
import { validateApiKeyAndGetUser } from "@/repository/key";
import { extractApiKeyFromHeaders } from "./auth-guard";

export const LOCAL_CAPACITY_BLOCKED_BY = "local_capacity";

/** 同一 key 的重试风暴只落一行，其余计入下一行的 suppressed，避免过载时再压数据库。 */
const THROTTLE_WINDOW_MS = 10_000;
const MAX_TRACKED_KEYS = 4096;

type ThrottleEntry = { lastLoggedAt: number; suppressed: number };
const throttle = new Map<string, ThrottleEntry>();

export interface LocalCapacityRejection {
  userId: number;
  apiKey: string;
  /** 拒绝发生的阶段：body_intake 表示认证前的正文准入，pipeline 表示认证后的守卫/转发阶段。 */
  stage: "body_intake" | "pipeline";
  errorMessage: string;
  durationMs?: number;
  model?: string | null;
  sessionId?: string | null;
  endpoint?: string | null;
  userAgent?: string | null;
  clientIp?: string | null;
}

function takeSuppressedCount(apiKey: string, now: number): number | null {
  const entry = throttle.get(apiKey);
  if (entry && now - entry.lastLoggedAt < THROTTLE_WINDOW_MS) {
    entry.suppressed++;
    return null;
  }
  if (!entry && throttle.size >= MAX_TRACKED_KEYS) {
    for (const [key, value] of throttle) {
      if (now - value.lastLoggedAt >= THROTTLE_WINDOW_MS) throttle.delete(key);
    }
    if (throttle.size >= MAX_TRACKED_KEYS) throttle.clear();
  }
  const suppressed = entry?.suppressed ?? 0;
  throttle.set(apiKey, { lastLoggedAt: now, suppressed: 0 });
  return suppressed;
}

/**
 * 本地容量 429 发生在 message_request 行创建之前，默认对仪表盘不可见。
 * 这里按被拦截请求的既有约定（providerId = 0 + blockedBy）补一行；失败不影响 429 响应。
 */
export async function recordLocalCapacityRejection(
  rejection: LocalCapacityRejection
): Promise<boolean> {
  const suppressed = takeSuppressedCount(rejection.apiKey, Date.now());
  if (suppressed === null) return false;
  return insertRejection(rejection, suppressed);
}

/**
 * 正文准入发生在认证之前，此时没有 session。仅在拒绝路径上用请求头里的 key 做一次
 * 尽力而为的归属；无法识别的 key 只留结构化日志。
 */
export async function recordPreAuthLocalCapacityRejection(
  c: Context,
  errorMessage: string,
  startTime: number
): Promise<boolean> {
  const url = new URL(c.req.url);
  logger.warn("[LocalCapacity] Request rejected during body intake", {
    pathname: url.pathname,
    contentLength: c.req.header("content-length") ?? null,
    governor: getMemoryGovernor().snapshot(),
  });

  try {
    const apiKey = extractApiKeyFromHeaders({
      authorization: c.req.header("authorization"),
      "x-api-key": c.req.header("x-api-key"),
      "x-goog-api-key": c.req.header("x-goog-api-key"),
    });
    if (!apiKey) return false;
    const suppressed = takeSuppressedCount(apiKey, Date.now());
    if (suppressed === null) return false;
    const auth = await validateApiKeyAndGetUser(apiKey);
    if (!auth) return false;
    return await insertRejection(
      {
        userId: auth.user.id,
        apiKey,
        stage: "body_intake",
        errorMessage,
        durationMs: Date.now() - startTime,
        endpoint: url.pathname,
        userAgent: c.req.header("user-agent") ?? null,
      },
      suppressed
    );
  } catch (error) {
    logger.error("[LocalCapacity] Failed to attribute pre-auth capacity rejection:", error);
    return false;
  }
}

async function insertRejection(
  rejection: LocalCapacityRejection,
  suppressed: number
): Promise<boolean> {
  try {
    const governor = getMemoryGovernor().snapshot();
    await db.insert(messageRequest).values({
      providerId: 0, // 特殊值：未到达任何供应商
      userId: rejection.userId,
      key: rejection.apiKey,
      model: rejection.model ?? undefined,
      sessionId: rejection.sessionId ?? undefined,
      endpoint: rejection.endpoint ?? undefined,
      userAgent: rejection.userAgent ?? undefined,
      clientIp: rejection.clientIp ?? undefined,
      statusCode: 429,
      durationMs: rejection.durationMs,
      costUsd: "0", // 不计费
      blockedBy: LOCAL_CAPACITY_BLOCKED_BY,
      blockedReason: JSON.stringify({
        stage: rejection.stage,
        suppressedSinceLastRow: suppressed,
        usedBytes: governor.usedBytes,
        limitBytes: governor.limitBytes,
        waiting: governor.waiting,
        rejected: governor.rejected,
      }),
      errorMessage: rejection.errorMessage,
    });
    return true;
  } catch (error) {
    logger.error("[LocalCapacity] Failed to log capacity rejection:", error);
    return false;
  }
}

export function resetLocalCapacityLogThrottleForTests(): void {
  throttle.clear();
}
