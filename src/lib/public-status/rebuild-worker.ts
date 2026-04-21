import { getRedisClient } from "@/lib/redis";
import { buildPublicStatusRebuildHintKey } from "./redis-contract";

const inFlightRebuilds = new Map<string, Promise<{ sourceGeneration: string }>>();
const REBUILD_HINT_TTL_SECONDS = 60 * 5;

interface RedisHintWriter {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  status?: string;
}

export async function runPublicStatusRebuild(input: {
  flightKey: string;
  computeGeneration: () => Promise<{ sourceGeneration: string }>;
}): Promise<{ sourceGeneration: string }> {
  const existing = inFlightRebuilds.get(input.flightKey);
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve()
    .then(() => input.computeGeneration())
    .finally(() => {
      inFlightRebuilds.delete(input.flightKey);
    });

  inFlightRebuilds.set(input.flightKey, promise);
  return promise;
}

// 调度入口先保持异步语义，后续接入真正的 Redis hint / scheduler 时继续扩展。
export async function schedulePublicStatusRebuild(input: {
  intervalMinutes: number;
  rangeHours: number;
  reason: string;
  redis?: RedisHintWriter | null;
}): Promise<{
  accepted: boolean;
  rebuildState: string;
  key?: string;
}> {
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return {
      accepted: false,
      rebuildState: "rebuilding",
    };
  }

  const key = buildPublicStatusRebuildHintKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  await redis.set(
    key,
    JSON.stringify({
      reason: input.reason,
      requestedAt: new Date().toISOString(),
      intervalMinutes: input.intervalMinutes,
      rangeHours: input.rangeHours,
    }),
    "EX",
    REBUILD_HINT_TTL_SECONDS
  );

  return {
    accepted: true,
    rebuildState: "rebuilding",
    key,
  };
}
