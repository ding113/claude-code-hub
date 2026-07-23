import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { getMessageWriterDb } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { normalizeRoutingTrace, type RoutingTraceV1 } from "@/types/routing-trace";
import { buildMonotonicRoutingTraceAssignments } from "./routing-trace-persistence";

const ROUTING_TRACE_OUTBOX_KEY = "cch:routing-trace-outbox:v1";
const DEFAULT_REPLAY_LIMIT = 100;
const REPLAY_INTERVAL_MS = 30_000;
const REDIS_READY_WAIT_MS = 500;
const REDIS_OPERATION_TIMEOUT_MS = 1_000;
const BACKLOG_WARN_THRESHOLD = 1_000;
const BACKLOG_ERROR_THRESHOLD = 10_000;
const BACKLOG_LOG_INTERVAL_MS = 5 * 60_000;

let lastBacklogLogAt = 0;

const STAGE_IF_NOT_OLDER_LUA = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  local current_revision = nil
  if ok and decoded then
    current_revision = tonumber(decoded.traceUpdatedAt)
  end
  local incoming_revision = tonumber(ARGV[2])
  if current_revision and incoming_revision and current_revision > incoming_revision then
    return 0
  end
  if current_revision and incoming_revision and current_revision == incoming_revision and current ~= ARGV[3] then
    return 0
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
return 1`;

const DELETE_IF_UNCHANGED_LUA = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current == ARGV[2] then
  return redis.call('HDEL', KEYS[1], ARGV[1])
end
return 0`;

type RoutingTraceOutboxEntry = {
  version: 1;
  requestId: number;
  traceUpdatedAt: number;
  routingTrace: RoutingTraceV1;
};

export type RoutingTraceOutboxReceipt = {
  field: string;
  payload: string;
};

export type RoutingTraceOutboxReplayResult = {
  available: boolean;
  cursor: string;
  scanned: number;
  replayed: number;
  discarded: number;
  retained: number;
  backlog: number | null;
};

type RoutingTraceOutboxSchedulerState = {
  cursor: string;
  intervalId: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  stopping: boolean;
};

const schedulerGlobal = globalThis as typeof globalThis & {
  __CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__?: RoutingTraceOutboxSchedulerState;
  __CCH_STOP_ROUTING_TRACE_OUTBOX__?: (options?: {
    wait?: boolean;
    maxWaitMs?: number;
  }) => Promise<void>;
};

function getReadyRedis(): Redis | null {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  return redis?.status === "ready" ? redis : null;
}

async function getReadyRedisForStage(): Promise<Redis | null> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status === "end") return null;
  if (redis.status === "ready") return redis;

  return new Promise<Redis | null>((resolve) => {
    let settled = false;
    const finish = (value: Redis | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      redis.removeListener("ready", onReady);
      redis.removeListener("end", onUnavailable);
      resolve(value);
    };
    const onReady = () => finish(redis);
    const onUnavailable = () => finish(null);
    const timer = setTimeout(
      () => finish(redis.status === "ready" ? redis : null),
      REDIS_READY_WAIT_MS
    );
    redis.once("ready", onReady);
    redis.once("end", onUnavailable);
  });
}

async function runRedisOperation<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("routing trace outbox Redis operation timed out")),
          REDIS_OPERATION_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function logBacklogPressure(backlog: number): void {
  if (backlog < BACKLOG_WARN_THRESHOLD) return;
  const now = Date.now();
  if (now - lastBacklogLogAt < BACKLOG_LOG_INTERVAL_MS) return;
  lastBacklogLogAt = now;
  const context = {
    backlog,
    warnThreshold: BACKLOG_WARN_THRESHOLD,
    errorThreshold: BACKLOG_ERROR_THRESHOLD,
  };
  if (backlog >= BACKLOG_ERROR_THRESHOLD) {
    logger.error("[RoutingTraceOutbox] Backlog requires intervention", context);
  } else {
    logger.warn("[RoutingTraceOutbox] Backlog is growing", context);
  }
}

function parseOutboxEntry(payload: string): RoutingTraceOutboxEntry | null {
  try {
    const value = JSON.parse(payload) as Partial<RoutingTraceOutboxEntry>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.requestId) ||
      (value.requestId ?? 0) <= 0 ||
      !Number.isFinite(value.traceUpdatedAt)
    ) {
      return null;
    }
    const routingTrace = normalizeRoutingTrace(value.routingTrace);
    if (!routingTrace || routingTrace.updatedAt !== value.traceUpdatedAt) return null;
    return {
      version: 1,
      requestId: value.requestId as number,
      traceUpdatedAt: value.traceUpdatedAt as number,
      routingTrace,
    };
  } catch {
    return null;
  }
}

async function deleteIfUnchanged(
  redis: Redis,
  receipt: RoutingTraceOutboxReceipt
): Promise<boolean> {
  try {
    const deleted = await runRedisOperation(
      redis.eval(
        DELETE_IF_UNCHANGED_LUA,
        1,
        ROUTING_TRACE_OUTBOX_KEY,
        receipt.field,
        receipt.payload
      )
    );
    return Number(deleted) > 0;
  } catch (error) {
    logger.warn("[RoutingTraceOutbox] Failed to acknowledge entry", {
      requestId: Number(receipt.field),
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function stageRoutingTraceOutbox(
  requestId: number,
  routingTrace: RoutingTraceV1
): Promise<RoutingTraceOutboxReceipt | null> {
  const normalized = normalizeRoutingTrace(routingTrace);
  if (!normalized || !Number.isSafeInteger(requestId) || requestId <= 0) {
    return null;
  }
  const redis = await getReadyRedisForStage();
  if (!redis) return null;

  const field = String(requestId);
  const payload = JSON.stringify({
    version: 1,
    requestId,
    traceUpdatedAt: normalized.updatedAt,
    routingTrace: normalized,
  } satisfies RoutingTraceOutboxEntry);
  try {
    const staged = await runRedisOperation(
      redis.eval(
        STAGE_IF_NOT_OLDER_LUA,
        1,
        ROUTING_TRACE_OUTBOX_KEY,
        field,
        String(normalized.updatedAt),
        payload
      )
    );
    return Number(staged) > 0 ? { field, payload } : null;
  } catch (error) {
    logger.warn("[RoutingTraceOutbox] Failed to stage entry", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function acknowledgeRoutingTraceOutbox(
  receipt: RoutingTraceOutboxReceipt
): Promise<boolean> {
  const redis = getReadyRedis();
  if (!redis) return false;
  return deleteIfUnchanged(redis, receipt);
}

export async function persistRoutingTraceMonotonically(
  requestId: number,
  routingTrace: RoutingTraceV1
): Promise<boolean> {
  const normalized = normalizeRoutingTrace(routingTrace);
  if (!normalized || !Number.isSafeInteger(requestId) || requestId <= 0) {
    return false;
  }
  const assignments = buildMonotonicRoutingTraceAssignments(normalized, {
    routingTrace: sql`${messageRequest.routingTrace}`,
    updatedAt: sql`${messageRequest.updatedAt}`,
  });
  const rows = await getMessageWriterDb()
    .update(messageRequest)
    .set({
      routingTrace: assignments.routingTrace,
      updatedAt: assignments.updatedAt,
    })
    .where(and(eq(messageRequest.id, requestId), isNull(messageRequest.deletedAt)))
    .returning({ id: messageRequest.id });
  return rows.length > 0;
}

export async function replayRoutingTraceOutbox(
  options: { cursor?: string; limit?: number } = {}
): Promise<RoutingTraceOutboxReplayResult> {
  const redis = getReadyRedis();
  const result: RoutingTraceOutboxReplayResult = {
    available: redis !== null,
    cursor: options.cursor ?? "0",
    scanned: 0,
    replayed: 0,
    discarded: 0,
    retained: 0,
    backlog: null,
  };
  if (!redis) return result;

  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_REPLAY_LIMIT));
  let page: [string, string[]];
  try {
    page = (await runRedisOperation(
      redis.hscan(ROUTING_TRACE_OUTBOX_KEY, result.cursor, "COUNT", limit)
    )) as [string, string[]];
  } catch (error) {
    logger.warn("[RoutingTraceOutbox] Failed to scan entries", {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  result.cursor = page[0];
  const fieldsAndPayloads = page[1];
  // Redis COUNT is a hint and a page may be larger than requested. Process the
  // complete returned page before advancing its cursor so no tail is skipped.
  for (let index = 0; index + 1 < fieldsAndPayloads.length; index += 2) {
    const field = fieldsAndPayloads[index];
    const payload = fieldsAndPayloads[index + 1];
    if (field === undefined || payload === undefined) continue;
    result.scanned++;
    const receipt = { field, payload } satisfies RoutingTraceOutboxReceipt;
    const entry = parseOutboxEntry(payload);
    if (!entry || field !== String(entry.requestId)) {
      if (await deleteIfUnchanged(redis, receipt)) result.discarded++;
      else result.retained++;
      continue;
    }

    try {
      const targetExists = await persistRoutingTraceMonotonically(
        entry.requestId,
        entry.routingTrace
      );
      if (targetExists) result.replayed++;
      else result.discarded++;
      if (!(await deleteIfUnchanged(redis, receipt))) result.retained++;
    } catch (error) {
      result.retained++;
      logger.warn("[RoutingTraceOutbox] Replay failed; entry retained", {
        requestId: entry.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    result.backlog = await runRedisOperation(redis.hlen(ROUTING_TRACE_OUTBOX_KEY));
    logBacklogPressure(result.backlog);
  } catch (error) {
    logger.warn("[RoutingTraceOutbox] Failed to read backlog", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}

async function runScheduledReplay(state: RoutingTraceOutboxSchedulerState): Promise<void> {
  if (state.stopping || state.inFlight) return;
  const task = (async () => {
    try {
      const result = await replayRoutingTraceOutbox({ cursor: state.cursor });
      if (!result.available) return;
      state.cursor = result.cursor;
      if (result.scanned > 0 || result.retained > 0) {
        logger.info("[RoutingTraceOutbox] Replay cycle completed", result);
      }
    } catch (error) {
      logger.warn("[RoutingTraceOutbox] Replay cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  state.inFlight = task;
  try {
    await task;
  } finally {
    if (state.inFlight === task) state.inFlight = null;
  }
}

export async function startRoutingTraceOutboxReplayScheduler(): Promise<void> {
  const existing = schedulerGlobal.__CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__;
  if (existing && !existing.stopping) return;

  const state: RoutingTraceOutboxSchedulerState = {
    cursor: "0",
    intervalId: null,
    inFlight: null,
    stopping: false,
  };
  schedulerGlobal.__CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__ = state;
  schedulerGlobal.__CCH_STOP_ROUTING_TRACE_OUTBOX__ = stopRoutingTraceOutboxReplayScheduler;
  // Recovery starts after migrations, but readiness must not wait for a slow
  // outbox row. The scheduler owns and joins this task during shutdown.
  void runScheduledReplay(state);

  state.intervalId = setInterval(() => {
    void runScheduledReplay(state);
  }, REPLAY_INTERVAL_MS);
  state.intervalId.unref?.();
}

export async function stopRoutingTraceOutboxReplayScheduler(
  options: { wait?: boolean; maxWaitMs?: number } = {}
): Promise<void> {
  const state = schedulerGlobal.__CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__;
  if (!state) return;
  state.stopping = true;
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (options.wait !== false && state.inFlight) {
    const maxWaitMs = options.maxWaitMs;
    if (maxWaitMs !== undefined && Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          state.inFlight,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, maxWaitMs);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } else {
      await state.inFlight;
    }
  }
  if (options.wait === false) return;
  if (schedulerGlobal.__CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__ === state) {
    schedulerGlobal.__CCH_ROUTING_TRACE_OUTBOX_SCHEDULER__ = undefined;
  }
  if (schedulerGlobal.__CCH_STOP_ROUTING_TRACE_OUTBOX__ === stopRoutingTraceOutboxReplayScheduler) {
    schedulerGlobal.__CCH_STOP_ROUTING_TRACE_OUTBOX__ = undefined;
  }
}
