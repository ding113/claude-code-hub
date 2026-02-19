import { logger } from "@/lib/logger";
import {
  getOverviewMetricsWithComparison,
  type OverviewMetricsWithComparison,
} from "@/repository/overview";
import { getRedisClient } from "./client";

const CACHE_TTL = 10;
const LOCK_TTL = 5;
const LOCK_WAIT_MS = 100;

function buildCacheKey(userId?: number): string {
  return userId !== undefined ? `overview:user:${userId}` : "overview:global";
}

/**
 * Get overview metrics with Redis caching (10s TTL).
 * Fail-open: Redis unavailable -> direct DB query.
 * Thundering herd protection via lock key.
 */
export async function getOverviewWithCache(
  userId?: number
): Promise<OverviewMetricsWithComparison> {
  const redis = getRedisClient();
  const cacheKey = buildCacheKey(userId);
  const lockKey = `${cacheKey}:lock`;

  if (!redis) {
    return await getOverviewMetricsWithComparison(userId);
  }

  let lockAcquired = false;
  let data: OverviewMetricsWithComparison | undefined;

  try {
    // 1. Try cache hit
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as OverviewMetricsWithComparison;
    }

    // 2. Acquire lock (prevent thundering herd)
    const lockResult = await redis.set(lockKey, "1", "EX", LOCK_TTL, "NX");
    lockAcquired = lockResult === "OK";

    if (!lockAcquired) {
      // Another instance is computing -- wait briefly and retry cache
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      const retried = await redis.get(cacheKey);
      if (retried) return JSON.parse(retried) as OverviewMetricsWithComparison;
      // Still nothing -- fallback to direct query
      return await getOverviewMetricsWithComparison(userId);
    }

    // 3. Cache miss -- query DB
    data = await getOverviewMetricsWithComparison(userId);

    // 4. Store in cache with TTL (best-effort)
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(data));
    } catch (writeErr) {
      logger.warn("[OverviewCache] Failed to write cache", { cacheKey, error: writeErr });
    }

    return data;
  } catch (error) {
    logger.warn("[OverviewCache] Redis error, fallback to direct query", { userId, error });
    return data ?? (await getOverviewMetricsWithComparison(userId));
  } finally {
    if (lockAcquired) {
      await redis
        .del(lockKey)
        .catch((err) =>
          logger.warn("[OverviewCache] Failed to release lock", { lockKey, error: err })
        );
    }
  }
}

/**
 * Invalidate overview cache for a specific user or global scope.
 */
export async function invalidateOverviewCache(userId?: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const cacheKey = buildCacheKey(userId);
  try {
    await redis.del(cacheKey);
    logger.info("[OverviewCache] Cache invalidated", { userId, cacheKey });
  } catch (error) {
    logger.error("[OverviewCache] Failed to invalidate cache", { userId, error });
  }
}
