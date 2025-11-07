import { getRedisClient } from "./client";
import { logger } from "@/lib/logger";
import { formatInTimeZone } from "date-fns-tz";
import { getEnvConfig } from "@/lib/config";
import {
  findDailyLeaderboard,
  findMonthlyLeaderboard,
  LeaderboardEntry,
} from "@/repository/leaderboard";

/**
 * 排行榜周期类型
 */
type LeaderboardPeriod = "daily" | "monthly";

/**
 * 构建缓存键
 */
function buildCacheKey(period: LeaderboardPeriod, currencyDisplay: string): string {
  const now = new Date();
  const tz = getEnvConfig().TZ; // ensure date formatting aligns with configured timezone

  if (period === "daily") {
    // leaderboard:daily:2025-01-15:USD
    const dateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");
    return `leaderboard:daily:${dateStr}:${currencyDisplay}`;
  } else {
    // leaderboard:monthly:2025-01:USD
    const monthStr = formatInTimeZone(now, tz, "yyyy-MM");
    return `leaderboard:monthly:${monthStr}:${currencyDisplay}`;
  }
}

/**
 * 查询数据库（根据周期）
 */
async function queryDatabase(period: LeaderboardPeriod): Promise<LeaderboardEntry[]> {
  if (period === "daily") {
    return await findDailyLeaderboard();
  } else {
    return await findMonthlyLeaderboard();
  }
}

/**
 * 睡眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 获取排行榜数据（带 Redis 乐观缓存）
 *
 * 策略：
 * 1. 优先从 Redis 读取缓存（60 秒 TTL）
 * 2. 缓存未命中时，使用分布式锁避免并发查询
 * 3. 未获得锁的请求等待并重试（最多 5 秒）
 * 4. Redis 不可用时降级到直接查询
 *
 * @param period - 排行榜周期（daily / monthly）
 * @param currencyDisplay - 货币显示单位（影响缓存键）
 * @returns 排行榜数据
 */
export async function getLeaderboardWithCache(
  period: LeaderboardPeriod,
  currencyDisplay: string
): Promise<LeaderboardEntry[]> {
  const redis = getRedisClient();

  // Redis 不可用，直接查数据库
  if (!redis) {
    logger.warn("[LeaderboardCache] Redis not available, fallback to direct query", { period });
    return await queryDatabase(period);
  }

  const cacheKey = buildCacheKey(period, currencyDisplay);
  const lockKey = `${cacheKey}:lock`;

  try {
    // 1. 尝试读缓存
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug("[LeaderboardCache] Cache hit", { period, cacheKey });
      return JSON.parse(cached) as LeaderboardEntry[];
    }

    // 2. 缓存未命中，尝试获取计算锁（SET NX EX 10 秒）
    const locked = await redis.set(lockKey, "1", "EX", 10, "NX");

    if (locked === "OK") {
      // 获得锁，查询数据库
      logger.debug("[LeaderboardCache] Acquired lock, computing", { period, lockKey });

      const data = await queryDatabase(period);

      // 写入缓存（60 秒 TTL）
      await redis.setex(cacheKey, 60, JSON.stringify(data));

      // 释放锁
      await redis.del(lockKey);

      logger.info("[LeaderboardCache] Cache updated", {
        period,
        recordCount: data.length,
        cacheKey,
        ttl: 60,
      });

      return data;
    } else {
      // 未获得锁，等待并重试（最多 50 次 × 100ms = 5 秒）
      logger.debug("[LeaderboardCache] Lock held by another request, retrying", { period });

      for (let i = 0; i < 50; i++) {
        await sleep(100);

        const retried = await redis.get(cacheKey);
        if (retried) {
          logger.debug("[LeaderboardCache] Cache hit after retry", {
            period,
            retries: i + 1,
          });
          return JSON.parse(retried) as LeaderboardEntry[];
        }
      }

      // 超时降级：直接查数据库
      logger.warn("[LeaderboardCache] Retry timeout, fallback to direct query", { period });
      return await queryDatabase(period);
    }
  } catch (error) {
    // Redis 异常，降级到直接查询
    logger.error("[LeaderboardCache] Redis error, fallback to direct query", {
      period,
      error,
    });
    return await queryDatabase(period);
  }
}

/**
 * 手动清除排行榜缓存
 *
 * @param period - 排行榜周期
 * @param currencyDisplay - 货币显示单位
 */
export async function invalidateLeaderboardCache(
  period: LeaderboardPeriod,
  currencyDisplay: string
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  const cacheKey = buildCacheKey(period, currencyDisplay);

  try {
    await redis.del(cacheKey);
    logger.info("[LeaderboardCache] Cache invalidated", { period, cacheKey });
  } catch (error) {
    logger.error("[LeaderboardCache] Failed to invalidate cache", { period, error });
  }
}
