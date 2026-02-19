import { logger } from "@/lib/logger";
import {
  getKeyStatisticsFromDB,
  getMixedStatisticsFromDB,
  getUserStatisticsFromDB,
} from "@/repository/statistics";
import type { DatabaseKeyStatRow, DatabaseStatRow, TimeRange } from "@/types/statistics";
import { getRedisClient } from "./client";

const CACHE_TTL = 30;
const LOCK_TTL = 5;

type MixedStatisticsResult = {
  ownKeys: DatabaseKeyStatRow[];
  othersAggregate: DatabaseStatRow[];
};

type StatisticsCacheData = DatabaseStatRow[] | DatabaseKeyStatRow[] | MixedStatisticsResult;

function buildCacheKey(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userId?: number
): string {
  const scope = userId !== undefined ? `${userId}` : "global";
  return `statistics:${timeRange}:${mode}:${scope}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryDatabase(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userId?: number
): Promise<StatisticsCacheData> {
  switch (mode) {
    case "users":
      return await getUserStatisticsFromDB(timeRange);
    case "keys":
      return await getKeyStatisticsFromDB(userId!, timeRange);
    case "mixed":
      return await getMixedStatisticsFromDB(userId!, timeRange);
  }
}

/**
 * Statistics data with Redis caching (30s TTL).
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

  if (!redis) {
    logger.warn("[StatisticsCache] Redis not available, fallback to direct query", {
      timeRange,
      mode,
      userId,
    });
    return await queryDatabase(timeRange, mode, userId);
  }

  const cacheKey = buildCacheKey(timeRange, mode, userId);
  const lockKey = `${cacheKey}:lock`;

  try {
    // 1. Try cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug("[StatisticsCache] Cache hit", { timeRange, mode, cacheKey });
      return JSON.parse(cached) as StatisticsCacheData;
    }

    // 2. Cache miss - acquire lock (SET NX EX)
    const locked = await redis.set(lockKey, "1", "EX", LOCK_TTL, "NX");

    if (locked === "OK") {
      logger.debug("[StatisticsCache] Acquired lock, computing", { timeRange, mode, lockKey });

      const data = await queryDatabase(timeRange, mode, userId);

      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(data));
      await redis.del(lockKey);

      logger.info("[StatisticsCache] Cache updated", {
        timeRange,
        mode,
        userId,
        cacheKey,
        ttl: CACHE_TTL,
      });

      return data;
    }

    // 3. Lock held by another request - wait and retry (up to 50 x 100ms = 5s)
    logger.debug("[StatisticsCache] Lock held by another request, retrying", { timeRange, mode });

    for (let i = 0; i < 50; i++) {
      await sleep(100);

      const retried = await redis.get(cacheKey);
      if (retried) {
        logger.debug("[StatisticsCache] Cache hit after retry", {
          timeRange,
          mode,
          retries: i + 1,
        });
        return JSON.parse(retried) as StatisticsCacheData;
      }
    }

    // Retry timeout - fallback to direct DB
    logger.warn("[StatisticsCache] Retry timeout, fallback to direct query", { timeRange, mode });
    return await queryDatabase(timeRange, mode, userId);
  } catch (error) {
    logger.error("[StatisticsCache] Redis error, fallback to direct query", {
      timeRange,
      mode,
      error,
    });
    return await queryDatabase(timeRange, mode, userId);
  }
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
      const keysToDelete = modes.map((m) => `statistics:${timeRange}:${m}:${scope}`);
      await redis.del(...keysToDelete);
      logger.info("[StatisticsCache] Cache invalidated", { timeRange, scope, keysToDelete });
    } else {
      const pattern = `statistics:*:*:${scope}`;
      const matchedKeys = await redis.keys(pattern);
      if (matchedKeys.length > 0) {
        await redis.del(...matchedKeys);
      }
      logger.info("[StatisticsCache] Cache invalidated (all timeRanges)", {
        scope,
        pattern,
        deletedCount: matchedKeys.length,
      });
    }
  } catch (error) {
    logger.error("[StatisticsCache] Failed to invalidate cache", { timeRange, scope, error });
  }
}
