import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import {
  getKeyStatisticsFromDB,
  getMixedStatisticsFromDB,
  getUserStatisticsFromDB,
} from "@/repository/statistics";
import { buildStatisticsCacheKey } from "@/types/dashboard-cache";
import type { DatabaseKeyStatRow, DatabaseStatRow, TimeRange } from "@/types/statistics";
import { getOrComputeWithRedisLock } from "./cache-aside";
import { getRedisClient } from "./client";
import { resolveDashboardCacheTtlSeconds } from "./dashboard-cache-ttl";
import { scanPattern } from "./scan-helper";

const CACHE_TTL = 30;
const CACHE_TTL_HIGH_CONCURRENCY = 60;
const LOCK_TTL = 5;

type MixedStatisticsResult = {
  ownKeys: DatabaseKeyStatRow[];
  othersAggregate: DatabaseStatRow[];
};

type StatisticsCacheData = DatabaseStatRow[] | DatabaseKeyStatRow[] | MixedStatisticsResult;

async function queryDatabase(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  timezone: string,
  userId?: number
): Promise<StatisticsCacheData> {
  if ((mode === "keys" || mode === "mixed") && userId === undefined) {
    throw new Error(`queryDatabase: userId required for mode="${mode}"`);
  }
  switch (mode) {
    case "users":
      return await getUserStatisticsFromDB(timeRange, timezone);
    case "keys":
      return await getKeyStatisticsFromDB(userId!, timeRange, timezone);
    case "mixed":
      return await getMixedStatisticsFromDB(userId!, timeRange, timezone);
  }
}

/**
 * Statistics data with Redis caching (30s TTL, 60s in high-concurrency mode).
 *
 * Strategy:
 * 1. Read from Redis cache first
 * 2. On cache miss, acquire distributed lock to prevent thundering herd
 * 3. Requests that fail to acquire lock wait and retry (up to 5s)
 * 4. Fail-open: Redis unavailable -> direct DB query
 */
export async function getStatisticsWithCache(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userId?: number
): Promise<StatisticsCacheData> {
  const redis = getRedisClient();
  const timezone = await resolveSystemTimezone();

  if (!redis) {
    logger.warn("[StatisticsCache] Redis not available, fallback to direct query", {
      timeRange,
      mode,
      userId,
    });
    return await queryDatabase(timeRange, mode, timezone, userId);
  }

  return getOrComputeWithRedisLock(redis, {
    name: "StatisticsCache",
    cacheKey: buildStatisticsCacheKey(timeRange, mode, userId, timezone),
    ttlSeconds: resolveDashboardCacheTtlSeconds(CACHE_TTL, CACHE_TTL_HIGH_CONCURRENCY),
    lockTtlSeconds: LOCK_TTL,
    waitTimeoutMs: 5_000,
    pollIntervalMs: 100,
    compute: () => queryDatabase(timeRange, mode, timezone, userId),
    logContext: { timeRange, mode, userId },
  });
}

/**
 * Invalidate statistics cache.
 *
 * - If timeRange provided: delete specific cache key
 * - If timeRange undefined: delete all time ranges for the scope using pattern match
 */
export async function invalidateStatisticsCache(
  timeRange?: TimeRange,
  userId?: number
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  const scope = userId !== undefined ? `${userId}` : "global";

  try {
    if (timeRange) {
      const modes = ["users", "keys", "mixed"] as const;
      const pattern = `statistics:${timeRange}:*:${scope}:tz:*`;
      const legacyKeysToDelete = modes.map((m) => `statistics:${timeRange}:${m}:${scope}`);
      const matchedKeys = await scanPattern(redis, pattern);
      const keysToDelete = [...matchedKeys, ...legacyKeysToDelete];
      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
      }
      logger.info("[StatisticsCache] Cache invalidated", { timeRange, scope, keysToDelete });
    } else {
      const pattern = `statistics:*:*:${scope}:tz:*`;
      const legacyPattern = `statistics:*:*:${scope}`;
      const matchedKeys = await scanPattern(redis, pattern);
      const legacyMatchedKeys = await scanPattern(redis, legacyPattern);
      const keysToDelete = [...new Set([...matchedKeys, ...legacyMatchedKeys])];
      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
      }
      logger.info("[StatisticsCache] Cache invalidated (all timeRanges)", {
        scope,
        pattern,
        deletedCount: keysToDelete.length,
      });
    }
  } catch (error) {
    logger.error("[StatisticsCache] Failed to invalidate cache", { timeRange, scope, error });
  }
}

export async function invalidateAllStatisticsCaches(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const keys = await scanPattern(redis, "statistics:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.info("[StatisticsCache] All caches invalidated", { deletedCount: keys.length });
  } catch (error) {
    logger.error("[StatisticsCache] Failed to invalidate all caches", { error });
  }
}
