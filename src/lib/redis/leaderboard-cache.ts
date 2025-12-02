import { formatInTimeZone } from "date-fns-tz";
import { getEnvConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  type DateRangeParams,
  findAllTimeLeaderboard,
  findAllTimeModelLeaderboard,
  findAllTimeProviderLeaderboard,
  findCustomRangeLeaderboard,
  findCustomRangeModelLeaderboard,
  findCustomRangeProviderLeaderboard,
  findDailyLeaderboard,
  findDailyModelLeaderboard,
  findDailyProviderLeaderboard,
  findMonthlyLeaderboard,
  findMonthlyModelLeaderboard,
  findMonthlyProviderLeaderboard,
  findWeeklyLeaderboard,
  findWeeklyModelLeaderboard,
  findWeeklyProviderLeaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type ModelLeaderboardEntry,
  type ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import { getRedisClient } from "./client";

export type { LeaderboardPeriod, DateRangeParams };
export type LeaderboardScope = "user" | "provider" | "model";

type LeaderboardData = LeaderboardEntry[] | ProviderLeaderboardEntry[] | ModelLeaderboardEntry[];

/**
 * 构建缓存键
 */
function buildCacheKey(
  period: LeaderboardPeriod,
  currencyDisplay: string,
  scope: LeaderboardScope = "user",
  dateRange?: DateRangeParams
): string {
  const now = new Date();
  const tz = getEnvConfig().TZ; // ensure date formatting aligns with configured timezone

  if (period === "custom" && dateRange) {
    // leaderboard:{scope}:custom:2025-01-01_2025-01-15:USD
    return `leaderboard:${scope}:custom:${dateRange.startDate}_${dateRange.endDate}:${currencyDisplay}`;
  } else if (period === "daily") {
    // leaderboard:{scope}:daily:2025-01-15:USD
    const dateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");
    return `leaderboard:${scope}:daily:${dateStr}:${currencyDisplay}`;
  } else if (period === "weekly") {
    // leaderboard:{scope}:weekly:2025-W03:USD (ISO week)
    const weekStr = formatInTimeZone(now, tz, "yyyy-'W'ww");
    return `leaderboard:${scope}:weekly:${weekStr}:${currencyDisplay}`;
  } else if (period === "monthly") {
    // leaderboard:{scope}:monthly:2025-01:USD
    const monthStr = formatInTimeZone(now, tz, "yyyy-MM");
    return `leaderboard:${scope}:monthly:${monthStr}:${currencyDisplay}`;
  } else {
    // allTime: leaderboard:{scope}:allTime:USD (no date component)
    return `leaderboard:${scope}:allTime:${currencyDisplay}`;
  }
}

/**
 * 查询数据库（根据周期）
 */
async function queryDatabase(
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
  dateRange?: DateRangeParams
): Promise<LeaderboardData> {
  // 处理自定义日期范围
  if (period === "custom" && dateRange) {
    if (scope === "user") {
      return await findCustomRangeLeaderboard(dateRange);
    }
    if (scope === "provider") {
      return await findCustomRangeProviderLeaderboard(dateRange);
    }
    return await findCustomRangeModelLeaderboard(dateRange);
  }

  if (scope === "user") {
    switch (period) {
      case "daily":
        return await findDailyLeaderboard();
      case "weekly":
        return await findWeeklyLeaderboard();
      case "monthly":
        return await findMonthlyLeaderboard();
      case "allTime":
        return await findAllTimeLeaderboard();
      default:
        return await findDailyLeaderboard();
    }
  }
  if (scope === "provider") {
    switch (period) {
      case "daily":
        return await findDailyProviderLeaderboard();
      case "weekly":
        return await findWeeklyProviderLeaderboard();
      case "monthly":
        return await findMonthlyProviderLeaderboard();
      case "allTime":
        return await findAllTimeProviderLeaderboard();
      default:
        return await findDailyProviderLeaderboard();
    }
  }
  // model scope
  switch (period) {
    case "daily":
      return await findDailyModelLeaderboard();
    case "weekly":
      return await findWeeklyModelLeaderboard();
    case "monthly":
      return await findMonthlyModelLeaderboard();
    case "allTime":
      return await findAllTimeModelLeaderboard();
    default:
      return await findDailyModelLeaderboard();
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
 * @param period - 排行榜周期（daily / weekly / monthly / allTime / custom）
 * @param currencyDisplay - 货币显示单位（影响缓存键）
 * @param scope - 排行榜维度（user / provider / model）
 * @param dateRange - 自定义日期范围（仅当 period 为 custom 时需要）
 * @returns 排行榜数据
 */
export async function getLeaderboardWithCache(
  period: LeaderboardPeriod,
  currencyDisplay: string,
  scope: LeaderboardScope = "user",
  dateRange?: DateRangeParams
): Promise<LeaderboardData> {
  const redis = getRedisClient();

  // Redis 不可用，直接查数据库
  if (!redis) {
    logger.warn("[LeaderboardCache] Redis not available, fallback to direct query", {
      period,
      scope,
      dateRange,
    });
    return await queryDatabase(period, scope, dateRange);
  }

  const cacheKey = buildCacheKey(period, currencyDisplay, scope, dateRange);
  const lockKey = `${cacheKey}:lock`;

  try {
    // 1. 尝试读缓存
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug("[LeaderboardCache] Cache hit", { period, cacheKey });
      return JSON.parse(cached) as LeaderboardData;
    }

    // 2. 缓存未命中，尝试获取计算锁（SET NX EX 10 秒）
    const locked = await redis.set(lockKey, "1", "EX", 10, "NX");

    if (locked === "OK") {
      // 获得锁，查询数据库
      logger.debug("[LeaderboardCache] Acquired lock, computing", { period, scope, lockKey });

      const data = await queryDatabase(period, scope, dateRange);

      // 写入缓存（60 秒 TTL）
      await redis.setex(cacheKey, 60, JSON.stringify(data));

      // 释放锁
      await redis.del(lockKey);

      logger.info("[LeaderboardCache] Cache updated", {
        period,
        scope,
        dateRange,
        recordCount: data.length,
        cacheKey,
        ttl: 60,
      });

      return data;
    } else {
      // 未获得锁，等待并重试（最多 50 次 × 100ms = 5 秒）
      logger.debug("[LeaderboardCache] Lock held by another request, retrying", { period, scope });

      for (let i = 0; i < 50; i++) {
        await sleep(100);

        const retried = await redis.get(cacheKey);
        if (retried) {
          logger.debug("[LeaderboardCache] Cache hit after retry", {
            period,
            retries: i + 1,
          });
          return JSON.parse(retried) as LeaderboardData;
        }
      }

      // 超时降级：直接查数据库
      logger.warn("[LeaderboardCache] Retry timeout, fallback to direct query", { period, scope });
      return await queryDatabase(period, scope, dateRange);
    }
  } catch (error) {
    // Redis 异常，降级到直接查询
    logger.error("[LeaderboardCache] Redis error, fallback to direct query", {
      period,
      scope,
      error,
    });
    return await queryDatabase(period, scope, dateRange);
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
  currencyDisplay: string,
  scope: LeaderboardScope = "user"
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  const cacheKey = buildCacheKey(period, currencyDisplay, scope);

  try {
    await redis.del(cacheKey);
    logger.info("[LeaderboardCache] Cache invalidated", { period, scope, cacheKey });
  } catch (error) {
    logger.error("[LeaderboardCache] Failed to invalidate cache", { period, scope, error });
  }
}
