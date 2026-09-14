import { formatInTimeZone } from "date-fns-tz";
import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import {
  type DateRangeParams,
  findAllTimeLeaderboard,
  findAllTimeModelLeaderboard,
  findAllTimeProviderCacheHitRateLeaderboard,
  findAllTimeProviderLeaderboard,
  findAllTimeUserCacheHitRateLeaderboard,
  findCustomRangeLeaderboard,
  findCustomRangeModelLeaderboard,
  findCustomRangeProviderCacheHitRateLeaderboard,
  findCustomRangeProviderLeaderboard,
  findCustomRangeUserCacheHitRateLeaderboard,
  findDailyLeaderboard,
  findDailyModelLeaderboard,
  findDailyProviderCacheHitRateLeaderboard,
  findDailyProviderLeaderboard,
  findDailyUserCacheHitRateLeaderboard,
  findMonthlyLeaderboard,
  findMonthlyModelLeaderboard,
  findMonthlyProviderCacheHitRateLeaderboard,
  findMonthlyProviderLeaderboard,
  findMonthlyUserCacheHitRateLeaderboard,
  findWeeklyLeaderboard,
  findWeeklyModelLeaderboard,
  findWeeklyProviderCacheHitRateLeaderboard,
  findWeeklyProviderLeaderboard,
  findWeeklyUserCacheHitRateLeaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type ModelLeaderboardEntry,
  type ProviderCacheHitRateLeaderboardEntry,
  type ProviderLeaderboardEntry,
  type UserCacheHitRateLeaderboardEntry,
  type UserLeaderboardFilters,
} from "@/repository/leaderboard";
import type { ProviderType } from "@/types/provider";
import { getOrComputeWithRedisLock } from "./cache-aside";
import { getRedisClient } from "./client";
import { resolveDashboardCacheTtlSeconds } from "./dashboard-cache-ttl";
import { scanPattern } from "./scan-helper";

export type { DateRangeParams, LeaderboardPeriod };
export type LeaderboardScope =
  | "user"
  | "userCacheHitRate"
  | "provider"
  | "providerCacheHitRate"
  | "model";

type LeaderboardData =
  | LeaderboardEntry[]
  | UserCacheHitRateLeaderboardEntry[]
  | ProviderLeaderboardEntry[]
  | ProviderCacheHitRateLeaderboardEntry[]
  | ModelLeaderboardEntry[];

export interface LeaderboardFilters {
  providerType?: ProviderType;
  userTags?: string[];
  userGroups?: string[];
  /** scope=provider / user / userCacheHitRate 时生效：是否包含按模型拆分的数据 */
  includeModelStats?: boolean;
}

/**
 * 缓存值 shape 版本：条目结构变更时递增，避免 60s TTL 内新旧 payload 混用。
 * v2: provider / providerCacheHitRate 条目新增 cacheCoefficientBp
 * v3: leaderboard latency fields use avgTtftMs instead of avgTtfbMs
 * v4: provider model breakdown entries include cacheCoefficientBp
 */
const CACHE_SHAPE_VERSION = "v4";

/**
 * 构建缓存键
 * @param timezone - 已解析的系统时区（调用者应使用 resolveSystemTimezone() 获取）
 */
function buildCacheKey(
  period: LeaderboardPeriod,
  currencyDisplay: string,
  timezone: string,
  scope: LeaderboardScope = "user",
  dateRange?: DateRangeParams,
  filters?: LeaderboardFilters
): string {
  const now = new Date();
  const providerTypeSuffix = filters?.providerType ? `:providerType:${filters.providerType}` : "";
  const includeModelStatsSuffix =
    (scope === "provider" || scope === "user" || scope === "userCacheHitRate") &&
    filters?.includeModelStats
      ? ":includeModelStats"
      : "";

  let userFilterSuffix = "";
  if (scope === "user" || scope === "userCacheHitRate") {
    const tagsPart = filters?.userTags?.length
      ? `:tags:${[...filters.userTags].sort().join(",")}`
      : "";
    const groupsPart = filters?.userGroups?.length
      ? `:groups:${[...filters.userGroups].sort().join(",")}`
      : "";
    userFilterSuffix = tagsPart + groupsPart;
  }

  const prefix = `leaderboard:${CACHE_SHAPE_VERSION}:${scope}`;

  if (period === "custom" && dateRange) {
    // leaderboard:v4:{scope}:custom:2025-01-01_2025-01-15:USD
    return `${prefix}:custom:${dateRange.startDate}_${dateRange.endDate}:tz:${timezone}:${currencyDisplay}${providerTypeSuffix}${includeModelStatsSuffix}${userFilterSuffix}`;
  } else if (period === "daily") {
    // leaderboard:v4:{scope}:daily:2025-01-15:USD
    const dateStr = formatInTimeZone(now, timezone, "yyyy-MM-dd");
    return `${prefix}:daily:${dateStr}:tz:${timezone}:${currencyDisplay}${providerTypeSuffix}${includeModelStatsSuffix}${userFilterSuffix}`;
  } else if (period === "weekly") {
    // leaderboard:v4:{scope}:weekly:2025-W03:USD (ISO week)
    const weekStr = formatInTimeZone(now, timezone, "yyyy-'W'ww");
    return `${prefix}:weekly:${weekStr}:tz:${timezone}:${currencyDisplay}${providerTypeSuffix}${includeModelStatsSuffix}${userFilterSuffix}`;
  } else if (period === "monthly") {
    // leaderboard:v4:{scope}:monthly:2025-01:USD
    const monthStr = formatInTimeZone(now, timezone, "yyyy-MM");
    return `${prefix}:monthly:${monthStr}:tz:${timezone}:${currencyDisplay}${providerTypeSuffix}${includeModelStatsSuffix}${userFilterSuffix}`;
  } else {
    // allTime: leaderboard:v4:{scope}:allTime:USD (no date component)
    return `${prefix}:allTime:tz:${timezone}:${currencyDisplay}${providerTypeSuffix}${includeModelStatsSuffix}${userFilterSuffix}`;
  }
}

/**
 * 查询数据库（根据周期）
 */
async function queryDatabase(
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
  dateRange?: DateRangeParams,
  filters?: LeaderboardFilters
): Promise<LeaderboardData> {
  const userFilters: UserLeaderboardFilters | undefined =
    (scope === "user" || scope === "userCacheHitRate") &&
    (filters?.userTags?.length || filters?.userGroups?.length)
      ? { userTags: filters.userTags, userGroups: filters.userGroups }
      : undefined;

  // 处理自定义日期范围
  if (period === "custom" && dateRange) {
    if (scope === "user") {
      return await findCustomRangeLeaderboard(dateRange, userFilters, filters?.includeModelStats);
    }
    if (scope === "userCacheHitRate") {
      return await findCustomRangeUserCacheHitRateLeaderboard(
        dateRange,
        userFilters,
        filters?.includeModelStats
      );
    }
    if (scope === "provider") {
      return await findCustomRangeProviderLeaderboard(
        dateRange,
        filters?.providerType,
        filters?.includeModelStats
      );
    }
    if (scope === "providerCacheHitRate") {
      return await findCustomRangeProviderCacheHitRateLeaderboard(dateRange, filters?.providerType);
    }
    return await findCustomRangeModelLeaderboard(dateRange);
  }

  if (scope === "user") {
    switch (period) {
      case "daily":
        return await findDailyLeaderboard(userFilters, filters?.includeModelStats);
      case "weekly":
        return await findWeeklyLeaderboard(userFilters, filters?.includeModelStats);
      case "monthly":
        return await findMonthlyLeaderboard(userFilters, filters?.includeModelStats);
      case "allTime":
        return await findAllTimeLeaderboard(userFilters, filters?.includeModelStats);
      default:
        return await findDailyLeaderboard(userFilters, filters?.includeModelStats);
    }
  }
  if (scope === "userCacheHitRate") {
    switch (period) {
      case "daily":
        return await findDailyUserCacheHitRateLeaderboard(userFilters, filters?.includeModelStats);
      case "weekly":
        return await findWeeklyUserCacheHitRateLeaderboard(userFilters, filters?.includeModelStats);
      case "monthly":
        return await findMonthlyUserCacheHitRateLeaderboard(
          userFilters,
          filters?.includeModelStats
        );
      case "allTime":
        return await findAllTimeUserCacheHitRateLeaderboard(
          userFilters,
          filters?.includeModelStats
        );
      default:
        return await findDailyUserCacheHitRateLeaderboard(userFilters, filters?.includeModelStats);
    }
  }
  if (scope === "provider") {
    switch (period) {
      case "daily":
        return await findDailyProviderLeaderboard(
          filters?.providerType,
          filters?.includeModelStats
        );
      case "weekly":
        return await findWeeklyProviderLeaderboard(
          filters?.providerType,
          filters?.includeModelStats
        );
      case "monthly":
        return await findMonthlyProviderLeaderboard(
          filters?.providerType,
          filters?.includeModelStats
        );
      case "allTime":
        return await findAllTimeProviderLeaderboard(
          filters?.providerType,
          filters?.includeModelStats
        );
      default:
        return await findDailyProviderLeaderboard(
          filters?.providerType,
          filters?.includeModelStats
        );
    }
  }
  if (scope === "providerCacheHitRate") {
    switch (period) {
      case "daily":
        return await findDailyProviderCacheHitRateLeaderboard(filters?.providerType);
      case "weekly":
        return await findWeeklyProviderCacheHitRateLeaderboard(filters?.providerType);
      case "monthly":
        return await findMonthlyProviderCacheHitRateLeaderboard(filters?.providerType);
      case "allTime":
        return await findAllTimeProviderCacheHitRateLeaderboard(filters?.providerType);
      default:
        return await findDailyProviderCacheHitRateLeaderboard(filters?.providerType);
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

const LEADERBOARD_CACHE_TTL_SECONDS = 60;
const LEADERBOARD_CACHE_TTL_HIGH_CONCURRENCY_SECONDS = 120;

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
  dateRange?: DateRangeParams,
  filters?: LeaderboardFilters
): Promise<LeaderboardData> {
  const redis = getRedisClient();

  // Redis 不可用，直接查数据库
  if (!redis) {
    logger.warn("[LeaderboardCache] Redis not available, fallback to direct query", {
      period,
      scope,
      dateRange,
      filters,
    });
    return await queryDatabase(period, scope, dateRange, filters);
  }

  // Resolve timezone once per request
  const timezone = await resolveSystemTimezone();

  return getOrComputeWithRedisLock(redis, {
    name: "LeaderboardCache",
    cacheKey: buildCacheKey(period, currencyDisplay, timezone, scope, dateRange, filters),
    ttlSeconds: resolveDashboardCacheTtlSeconds(
      LEADERBOARD_CACHE_TTL_SECONDS,
      LEADERBOARD_CACHE_TTL_HIGH_CONCURRENCY_SECONDS
    ),
    lockTtlSeconds: 10,
    // 未获得锁时等待并重试（最多 50 次 × 100ms = 5 秒）
    waitTimeoutMs: 5_000,
    pollIntervalMs: 100,
    compute: () => queryDatabase(period, scope, dateRange, filters),
    logContext: { period, scope },
  });
}

/**
 * 手动清除排行榜缓存
 *
 * @param period - 排行榜周期
 * @param currencyDisplay - 货币显示单位
 * @param scope - 榜单范围
 * @param dateRange - 自定义日期范围（仅 period=custom 时使用）
 * @param filters - 过滤条件（会影响缓存键）
 */
export async function invalidateLeaderboardCache(
  period: LeaderboardPeriod,
  currencyDisplay: string,
  scope: LeaderboardScope = "user",
  dateRange?: DateRangeParams,
  filters?: LeaderboardFilters
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  // Resolve timezone once per request
  const timezone = await resolveSystemTimezone();
  const cacheKey = buildCacheKey(period, currencyDisplay, timezone, scope, dateRange, filters);

  try {
    await redis.del(cacheKey);
    logger.info("[LeaderboardCache] Cache invalidated", { period, scope, cacheKey });
  } catch (error) {
    logger.error("[LeaderboardCache] Failed to invalidate cache", { period, scope, error });
  }
}

export async function invalidateAllLeaderboardCaches(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const keys = await scanPattern(redis, "leaderboard:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    logger.info("[LeaderboardCache] All caches invalidated", { deletedCount: keys.length });
  } catch (error) {
    logger.error("[LeaderboardCache] Failed to invalidate all caches", { error });
  }
}
