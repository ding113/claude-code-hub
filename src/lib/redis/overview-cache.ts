import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import {
  getOverviewMetricsWithComparison,
  type OverviewMetricsWithComparison,
} from "@/repository/overview";
import { buildOverviewCacheKey } from "@/types/dashboard-cache";
import { getOrComputeWithRedisLock } from "./cache-aside";
import { getRedisClient } from "./client";
import { resolveDashboardCacheTtlSeconds } from "./dashboard-cache-ttl";
import { scanPattern } from "./scan-helper";

const CACHE_TTL = 10;
const CACHE_TTL_HIGH_CONCURRENCY = 30;
const LOCK_TTL = 5;
const LOCK_WAIT_MS = 100;

function buildCacheKey(userId: number | undefined, timezone: string): string {
  return userId !== undefined
    ? buildOverviewCacheKey("user", userId, timezone)
    : buildOverviewCacheKey("global", timezone);
}

/**
 * Get overview metrics with Redis caching (10s TTL, 30s in high-concurrency mode).
 * Fail-open: Redis unavailable -> direct DB query.
 * Thundering herd protection via lock key.
 */
export async function getOverviewWithCache(
  userId?: number
): Promise<OverviewMetricsWithComparison> {
  const redis = getRedisClient();
  const timezone = await resolveSystemTimezone();

  return getOrComputeWithRedisLock(redis, {
    name: "OverviewCache",
    cacheKey: buildCacheKey(userId, timezone),
    ttlSeconds: resolveDashboardCacheTtlSeconds(CACHE_TTL, CACHE_TTL_HIGH_CONCURRENCY),
    lockTtlSeconds: LOCK_TTL,
    // Overview is cheap to recompute: wait for one poll interval only.
    waitTimeoutMs: LOCK_WAIT_MS,
    pollIntervalMs: LOCK_WAIT_MS,
    compute: () => getOverviewMetricsWithComparison(userId),
    logContext: { userId },
  });
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
