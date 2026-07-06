import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import {
  getOverviewMetricsWithComparison,
  type OverviewMetricsWithComparison,
} from "@/repository/overview";
import { buildOverviewCacheKey } from "@/types/dashboard-cache";
import { getRedisClient } from "./client";
import { scanPattern } from "./scan-helper";

const CACHE_TTL = 10;
const LOCK_TTL = 5;
const LOCK_WAIT_MS = 100;

function buildCacheKey(userId: number | undefined, timezone: string): string {
  return userId !== undefined
    ? buildOverviewCacheKey("user", userId, timezone)
    : buildOverviewCacheKey("global", timezone);
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
  const timezone = await resolveSystemTimezone();
  const cacheKey = buildCacheKey(userId, timezone);
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

  const scopePattern = userId !== undefined ? `overview:user:${userId}` : "overview:global";
  const pattern = `${scopePattern}:tz:*`;
  try {
    const matchedKeys = await scanPattern(redis, pattern);
    const keysToDelete = [...matchedKeys, scopePattern];
    await redis.del(...keysToDelete);
    logger.info("[OverviewCache] Cache invalidated", { userId, keysToDelete });
  } catch (error) {
    logger.error("[OverviewCache] Failed to invalidate cache", { userId, error });
  }
}

export async function invalidateAllOverviewCaches(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const keys = await scanPattern(redis, "overview:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.info("[OverviewCache] All caches invalidated", { deletedCount: keys.length });
  } catch (error) {
    logger.error("[OverviewCache] Failed to invalidate all caches", { error });
  }
}
