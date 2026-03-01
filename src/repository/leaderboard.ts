"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers, usageLedger, users } from "@/drizzle/schema";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type { ProviderType } from "@/types/provider";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";
import { getSystemSettings } from "./system-config";

/**
 * 排行榜条目类型
 */
export interface LeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

/**
 * 用户排行榜筛选参数
 */
export interface UserLeaderboardFilters {
  /** 按用户标签筛选（OR 逻辑：匹配任一标签） */
  userTags?: string[];
  /** 按用户分组筛选（OR 逻辑：匹配任一分组） */
  userGroups?: string[];
}

/**
 * 供应商排行榜条目类型
 */
export interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number; // 0-1 之间的小数，UI 层负责格式化为百分比
  avgTtfbMs: number; // 毫秒
  avgTokensPerSecond: number; // tok/s（仅统计流式且可计算的请求）
  avgCostPerRequest: number | null; // totalCost / totalRequests, null when totalRequests === 0
  avgCostPerMillionTokens: number | null; // totalCost * 1_000_000 / totalTokens, null when totalTokens === 0
  /** 可选：按模型拆分（仅在 includeModelStats=true 时填充） */
  modelStats?: ModelProviderStat[];
}

/**
 * 供应商消耗排行榜 - 模型级统计
 */
export interface ModelProviderStat {
  model: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number; // 0-1
  avgTtfbMs: number; // 毫秒
  avgTokensPerSecond: number; // tok/s
  avgCostPerRequest: number | null;
  avgCostPerMillionTokens: number | null;
}

/**
 * 供应商缓存命中率 - 模型级统计
 */
export interface ModelCacheHitStat {
  model: string;
  totalRequests: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  cacheHitRate: number; // 0-1
}

/**
 * 供应商缓存命中率排行榜条目类型
 */
export interface ProviderCacheHitRateLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  cacheReadTokens: number;
  totalCost: number;
  cacheCreationCost: number;
  /** Input tokens only (input + cacheCreation + cacheRead) for cache hit rate denominator */
  totalInputTokens: number;
  /** @deprecated Use totalInputTokens instead */
  totalTokens: number;
  cacheHitRate: number; // 0-1 之间的小数，UI 层负责格式化为百分比
  modelStats: ModelCacheHitStat[];
}

/**
 * 模型排行榜条目类型
 */
export interface ModelLeaderboardEntry {
  model: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number; // 0-1 之间的小数，UI 层负责格式化为百分比
}

/**
 * 查询今日消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于系统时区
 */
export async function findDailyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("daily", timezone, undefined, userFilters);
}

/**
 * 查询本月消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于系统时区
 */
export async function findMonthlyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("monthly", timezone, undefined, userFilters);
}

/**
 * 查询本周消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本周"基于系统时区
 */
export async function findWeeklyLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("weekly", timezone, undefined, userFilters);
}

/**
 * 查询全部时间消耗排行榜（不限制数量）
 */
export async function findAllTimeLeaderboard(
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("allTime", timezone, undefined, userFilters);
}

/**
 * 查询过去24小时消耗排行榜（用于通知推送）
 * 使用滚动24小时窗口而非日历日
 */
export async function findLast24HoursLeaderboard(): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("last24h", timezone);
}

/**
 * 排行榜周期类型
 */
export type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "allTime" | "custom" | "last24h";

/**
 * 自定义日期范围参数
 */
export interface DateRangeParams {
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
}

/**
 * 构建日期条件 SQL
 */
function buildDateCondition(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams
) {
  const nowLocal = sql`CURRENT_TIMESTAMP AT TIME ZONE ${timezone}`;

  if (period === "custom" && dateRange) {
    // 自定义日期范围：startDate <= local_date <= endDate
    const startLocal = sql`(${dateRange.startDate}::date)::timestamp`;
    const endExclusiveLocal = sql`(${dateRange.endDate}::date + INTERVAL '1 day')`;
    const start = sql`(${startLocal} AT TIME ZONE ${timezone})`;
    const endExclusive = sql`(${endExclusiveLocal} AT TIME ZONE ${timezone})`;
    return sql`${usageLedger.createdAt} >= ${start} AND ${usageLedger.createdAt} < ${endExclusive}`;
  }

  switch (period) {
    case "allTime":
      return sql`1=1`;
    case "daily": {
      const startLocal = sql`DATE_TRUNC('day', ${nowLocal})`;
      const endExclusiveLocal = sql`(${startLocal} + INTERVAL '1 day')`;
      const start = sql`(${startLocal} AT TIME ZONE ${timezone})`;
      const endExclusive = sql`(${endExclusiveLocal} AT TIME ZONE ${timezone})`;
      return sql`${usageLedger.createdAt} >= ${start} AND ${usageLedger.createdAt} < ${endExclusive}`;
    }
    case "last24h":
      return sql`${usageLedger.createdAt} >= (CURRENT_TIMESTAMP - INTERVAL '24 hours')`;
    case "weekly": {
      const startLocal = sql`DATE_TRUNC('week', ${nowLocal})`;
      const endExclusiveLocal = sql`(${startLocal} + INTERVAL '1 week')`;
      const start = sql`(${startLocal} AT TIME ZONE ${timezone})`;
      const endExclusive = sql`(${endExclusiveLocal} AT TIME ZONE ${timezone})`;
      return sql`${usageLedger.createdAt} >= ${start} AND ${usageLedger.createdAt} < ${endExclusive}`;
    }
    case "monthly": {
      const startLocal = sql`DATE_TRUNC('month', ${nowLocal})`;
      const endExclusiveLocal = sql`(${startLocal} + INTERVAL '1 month')`;
      const start = sql`(${startLocal} AT TIME ZONE ${timezone})`;
      const endExclusive = sql`(${endExclusiveLocal} AT TIME ZONE ${timezone})`;
      return sql`${usageLedger.createdAt} >= ${start} AND ${usageLedger.createdAt} < ${endExclusive}`;
    }
    default:
      return sql`1=1`;
  }
}

/**
 * 通用排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 */
async function findLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams,
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const whereConditions = [
    LEDGER_BILLING_CONDITION,
    buildDateCondition(period, timezone, dateRange),
  ];

  const normalizedTags = (userFilters?.userTags ?? []).map((t) => t.trim()).filter(Boolean);
  let tagFilterCondition: ReturnType<typeof sql> | undefined;
  if (normalizedTags.length > 0) {
    const tagConditions = normalizedTags.map((tag) => sql`${users.tags} ? ${tag}`);
    tagFilterCondition = sql`(${sql.join(tagConditions, sql` OR `)})`;
  }

  const normalizedGroups = (userFilters?.userGroups ?? []).map((g) => g.trim()).filter(Boolean);
  let groupFilterCondition: ReturnType<typeof sql> | undefined;
  if (normalizedGroups.length > 0) {
    const groupConditions = normalizedGroups.map(
      (group) =>
        sql`${group} = ANY(regexp_split_to_array(coalesce(${users.providerGroup}, ''), '\\s*,\\s*'))`
    );
    groupFilterCondition = sql`(${sql.join(groupConditions, sql` OR `)})`;
  }

  if (tagFilterCondition && groupFilterCondition) {
    whereConditions.push(sql`(${tagFilterCondition} OR ${groupFilterCondition})`);
  } else if (tagFilterCondition) {
    whereConditions.push(tagFilterCondition);
  } else if (groupFilterCondition) {
    whereConditions.push(groupFilterCondition);
  }

  const rankings = await db
    .select({
      userId: usageLedger.userId,
      userName: users.name,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${usageLedger.inputTokens} +
          ${usageLedger.outputTokens} +
          COALESCE(${usageLedger.cacheCreationInputTokens}, 0) +
          COALESCE(${usageLedger.cacheReadInputTokens}, 0)
        )::double precision,
        0::double precision
      )`,
    })
    .from(usageLedger)
    .innerJoin(users, and(sql`${usageLedger.userId} = ${users.id}`, isNull(users.deletedAt)))
    .where(and(...whereConditions))
    .groupBy(usageLedger.userId, users.name)
    .orderBy(desc(sql`sum(${usageLedger.costUsd})`));

  return rankings.map((entry) => ({
    userId: entry.userId,
    userName: entry.userName,
    totalRequests: entry.totalRequests,
    totalCost: parseFloat(entry.totalCost),
    totalTokens: entry.totalTokens,
  }));
}

/**
 * 查询自定义日期范围消耗排行榜
 */
export async function findCustomRangeLeaderboard(
  dateRange: DateRangeParams,
  userFilters?: UserLeaderboardFilters
): Promise<LeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findLeaderboardWithTimezone("custom", timezone, dateRange, userFilters);
}

/**
 * 查询今日供应商消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于系统时区
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
export async function findDailyProviderLeaderboard(
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderLeaderboardWithTimezone(
    "daily",
    timezone,
    undefined,
    providerType,
    includeModelStats
  );
}

/**
 * 查询本月供应商消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于系统时区
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
export async function findMonthlyProviderLeaderboard(
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderLeaderboardWithTimezone(
    "monthly",
    timezone,
    undefined,
    providerType,
    includeModelStats
  );
}

/**
 * 查询本周供应商消耗排行榜（不限制数量）
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
export async function findWeeklyProviderLeaderboard(
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderLeaderboardWithTimezone(
    "weekly",
    timezone,
    undefined,
    providerType,
    includeModelStats
  );
}

/**
 * 查询全部时间供应商消耗排行榜（不限制数量）
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
export async function findAllTimeProviderLeaderboard(
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderLeaderboardWithTimezone(
    "allTime",
    timezone,
    undefined,
    providerType,
    includeModelStats
  );
}

/**
 * 查询今日供应商缓存命中率排行榜（不限制数量）
 */
export async function findDailyProviderCacheHitRateLeaderboard(
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderCacheHitRateLeaderboardWithTimezone(
    "daily",
    timezone,
    undefined,
    providerType
  );
}

/**
 * 查询本月供应商缓存命中率排行榜（不限制数量）
 */
export async function findMonthlyProviderCacheHitRateLeaderboard(
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderCacheHitRateLeaderboardWithTimezone(
    "monthly",
    timezone,
    undefined,
    providerType
  );
}

/**
 * 查询本周供应商缓存命中率排行榜（不限制数量）
 */
export async function findWeeklyProviderCacheHitRateLeaderboard(
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderCacheHitRateLeaderboardWithTimezone(
    "weekly",
    timezone,
    undefined,
    providerType
  );
}

/**
 * 查询全部时间供应商缓存命中率排行榜（不限制数量）
 */
export async function findAllTimeProviderCacheHitRateLeaderboard(
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderCacheHitRateLeaderboardWithTimezone(
    "allTime",
    timezone,
    undefined,
    providerType
  );
}

/**
 * 通用供应商排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
async function findProviderLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams,
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const whereConditions = [
    LEDGER_BILLING_CONDITION,
    buildDateCondition(period, timezone, dateRange),
    providerType ? eq(providers.providerType, providerType) : undefined,
  ];

  const totalRequestsExpr = sql<number>`count(*)::double precision`;
  const totalCostExpr = sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`;
  const totalTokensExpr = sql<number>`COALESCE(
    sum(
      ${usageLedger.inputTokens} +
      ${usageLedger.outputTokens} +
      COALESCE(${usageLedger.cacheCreationInputTokens}, 0) +
      COALESCE(${usageLedger.cacheReadInputTokens}, 0)
    )::double precision,
    0::double precision
  )`;
  const successRateExpr = sql<number>`COALESCE(
    count(CASE WHEN ${usageLedger.isSuccess} THEN 1 END)::double precision
    / NULLIF(count(*)::double precision, 0),
    0::double precision
  )`;
  const avgTtfbMsExpr = sql<number>`COALESCE(avg(${usageLedger.ttfbMs})::double precision, 0::double precision)`;
  const avgTokensPerSecondExpr = sql<number>`COALESCE(
    avg(
      CASE
        WHEN ${usageLedger.outputTokens} > 0
          AND ${usageLedger.durationMs} IS NOT NULL
          AND ${usageLedger.ttfbMs} IS NOT NULL
          AND ${usageLedger.ttfbMs} < ${usageLedger.durationMs}
          AND (${usageLedger.durationMs} - ${usageLedger.ttfbMs}) >= 100
        THEN (${usageLedger.outputTokens}::double precision)
          / ((${usageLedger.durationMs} - ${usageLedger.ttfbMs}) / 1000.0)
      END
    )::double precision,
    0::double precision
  )`;

  const computeAvgCosts = (totalCost: number, totalRequests: number, totalTokens: number) => ({
    avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : null,
    avgCostPerMillionTokens: totalTokens > 0 ? (totalCost * 1_000_000) / totalTokens : null,
  });

  const rankings = await db
    .select({
      providerId: usageLedger.finalProviderId,
      providerName: providers.name,
      totalRequests: totalRequestsExpr,
      totalCost: totalCostExpr,
      totalTokens: totalTokensExpr,
      successRate: successRateExpr,
      avgTtfbMs: avgTtfbMsExpr,
      avgTokensPerSecond: avgTokensPerSecondExpr,
    })
    .from(usageLedger)
    .innerJoin(
      providers,
      and(sql`${usageLedger.finalProviderId} = ${providers.id}`, isNull(providers.deletedAt))
    )
    .where(
      and(...whereConditions.filter((c): c is NonNullable<(typeof whereConditions)[number]> => !!c))
    )
    .groupBy(usageLedger.finalProviderId, providers.name)
    .orderBy(desc(sql`sum(${usageLedger.costUsd})`));

  const baseEntries: ProviderLeaderboardEntry[] = rankings.map((entry) => {
    const totalCost = parseFloat(entry.totalCost);
    const totalRequests = entry.totalRequests;
    const totalTokens = entry.totalTokens;
    const avgCosts = computeAvgCosts(totalCost, totalRequests, totalTokens);
    return {
      providerId: entry.providerId,
      providerName: entry.providerName,
      totalRequests,
      totalCost,
      totalTokens,
      successRate: entry.successRate ?? 0,
      avgTtfbMs: entry.avgTtfbMs ?? 0,
      avgTokensPerSecond: entry.avgTokensPerSecond ?? 0,
      ...avgCosts,
    };
  });

  if (!includeModelStats) return baseEntries;

  // Model breakdown per provider
  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;
  const modelField =
    billingModelSource === "original"
      ? sql<string>`COALESCE(${usageLedger.originalModel}, ${usageLedger.model})`
      : sql<string>`COALESCE(${usageLedger.model}, ${usageLedger.originalModel})`;

  const modelRows = await db
    .select({
      providerId: usageLedger.finalProviderId,
      model: modelField,
      totalRequests: totalRequestsExpr,
      totalCost: totalCostExpr,
      totalTokens: totalTokensExpr,
      successRate: successRateExpr,
      avgTtfbMs: avgTtfbMsExpr,
      avgTokensPerSecond: avgTokensPerSecondExpr,
    })
    .from(usageLedger)
    .innerJoin(
      providers,
      and(sql`${usageLedger.finalProviderId} = ${providers.id}`, isNull(providers.deletedAt))
    )
    .where(
      and(...whereConditions.filter((c): c is NonNullable<(typeof whereConditions)[number]> => !!c))
    )
    .groupBy(usageLedger.finalProviderId, modelField)
    .orderBy(desc(sql`sum(${usageLedger.costUsd})`), desc(sql`count(*)`));

  const modelStatsByProvider = new Map<number, ModelProviderStat[]>();
  for (const row of modelRows) {
    if (!row.model?.trim()) continue;
    const totalCost = parseFloat(row.totalCost);
    const totalRequests = row.totalRequests;
    const totalTokens = row.totalTokens;
    const avgCosts = computeAvgCosts(totalCost, totalRequests, totalTokens);
    const stats = modelStatsByProvider.get(row.providerId) ?? [];
    stats.push({
      model: row.model,
      totalRequests,
      totalCost,
      totalTokens,
      successRate: Math.min(Math.max(row.successRate ?? 0, 0), 1),
      avgTtfbMs: row.avgTtfbMs ?? 0,
      avgTokensPerSecond: row.avgTokensPerSecond ?? 0,
      ...avgCosts,
    });
    modelStatsByProvider.set(row.providerId, stats);
  }

  return baseEntries.map((entry) => ({
    ...entry,
    modelStats: modelStatsByProvider.get(entry.providerId) ?? [],
  }));
}

/**
 * 通用供应商缓存命中率排行榜查询函数
 *
 * 计算规则：
 * - 仅统计需要缓存的请求（cache_creation_input_tokens 与 cache_read_input_tokens 不同时为 0/null）
 * - 命中率 = cache_read / (input + cache_creation + cache_read)
 */
async function findProviderCacheHitRateLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams,
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const totalInputTokensExpr = sql<number>`(
    COALESCE(${usageLedger.inputTokens}, 0)::double precision +
    COALESCE(${usageLedger.cacheCreationInputTokens}, 0)::double precision +
    COALESCE(${usageLedger.cacheReadInputTokens}, 0)::double precision
  )`;

  const cacheRequiredCondition = sql`(
    COALESCE(${usageLedger.cacheCreationInputTokens}, 0) > 0
    OR COALESCE(${usageLedger.cacheReadInputTokens}, 0) > 0
  )`;

  const sumTotalInputTokens = sql<number>`COALESCE(sum(${totalInputTokensExpr})::double precision, 0::double precision)`;
  const sumCacheReadTokens = sql<number>`COALESCE(sum(COALESCE(${usageLedger.cacheReadInputTokens}, 0))::double precision, 0::double precision)`;
  const sumCacheCreationCost = sql<string>`COALESCE(sum(CASE WHEN COALESCE(${usageLedger.cacheCreationInputTokens}, 0) > 0 THEN ${usageLedger.costUsd} ELSE 0 END), 0)`;

  const cacheHitRateExpr = sql<number>`COALESCE(
    ${sumCacheReadTokens} / NULLIF(${sumTotalInputTokens}, 0::double precision),
    0::double precision
  )`;

  const whereConditions = [
    LEDGER_BILLING_CONDITION,
    buildDateCondition(period, timezone, dateRange),
    cacheRequiredCondition,
    providerType ? eq(providers.providerType, providerType) : undefined,
  ];

  const rankings = await db
    .select({
      providerId: usageLedger.finalProviderId,
      providerName: providers.name,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
      cacheReadTokens: sumCacheReadTokens,
      cacheCreationCost: sumCacheCreationCost,
      totalInputTokens: sumTotalInputTokens,
      cacheHitRate: cacheHitRateExpr,
    })
    .from(usageLedger)
    .innerJoin(
      providers,
      and(sql`${usageLedger.finalProviderId} = ${providers.id}`, isNull(providers.deletedAt))
    )
    .where(
      and(...whereConditions.filter((c): c is NonNullable<(typeof whereConditions)[number]> => !!c))
    )
    .groupBy(usageLedger.finalProviderId, providers.name)
    .orderBy(desc(cacheHitRateExpr), desc(sql`count(*)`));

  // Model-level cache hit breakdown per provider
  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;
  const modelField =
    billingModelSource === "original"
      ? sql<string>`COALESCE(${usageLedger.originalModel}, ${usageLedger.model})`
      : sql<string>`COALESCE(${usageLedger.model}, ${usageLedger.originalModel})`;

  const modelTotalInput = sql<number>`COALESCE(sum(${totalInputTokensExpr})::double precision, 0::double precision)`;
  const modelCacheRead = sql<number>`COALESCE(sum(COALESCE(${usageLedger.cacheReadInputTokens}, 0))::double precision, 0::double precision)`;
  const modelCacheHitRate = sql<number>`COALESCE(
    ${modelCacheRead} / NULLIF(${modelTotalInput}, 0::double precision),
    0::double precision
  )`;

  const modelRows = await db
    .select({
      providerId: usageLedger.finalProviderId,
      model: modelField,
      totalRequests: sql<number>`count(*)::double precision`,
      cacheReadTokens: modelCacheRead,
      totalInputTokens: modelTotalInput,
      cacheHitRate: modelCacheHitRate,
    })
    .from(usageLedger)
    .innerJoin(
      providers,
      and(sql`${usageLedger.finalProviderId} = ${providers.id}`, isNull(providers.deletedAt))
    )
    .where(
      and(...whereConditions.filter((c): c is NonNullable<(typeof whereConditions)[number]> => !!c))
    )
    .groupBy(usageLedger.finalProviderId, modelField)
    .orderBy(desc(modelCacheHitRate), desc(sql`count(*)`));

  // Group model stats by providerId
  const modelStatsByProvider = new Map<number, ModelCacheHitStat[]>();
  for (const row of modelRows) {
    if (!row.model || row.model.trim() === "") continue;
    const stats = modelStatsByProvider.get(row.providerId) ?? [];
    stats.push({
      model: row.model,
      totalRequests: row.totalRequests,
      cacheReadTokens: row.cacheReadTokens,
      totalInputTokens: row.totalInputTokens,
      cacheHitRate: Math.min(Math.max(row.cacheHitRate ?? 0, 0), 1),
    });
    modelStatsByProvider.set(row.providerId, stats);
  }

  return rankings.map((entry) => ({
    providerId: entry.providerId,
    providerName: entry.providerName,
    totalRequests: entry.totalRequests,
    totalCost: parseFloat(entry.totalCost),
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationCost: parseFloat(entry.cacheCreationCost),
    totalInputTokens: entry.totalInputTokens,
    totalTokens: entry.totalInputTokens, // deprecated, for backward compatibility
    cacheHitRate: Math.min(Math.max(entry.cacheHitRate ?? 0, 0), 1),
    modelStats: modelStatsByProvider.get(entry.providerId) ?? [],
  }));
}

/**
 * 查询自定义日期范围供应商消耗排行榜
 * includeModelStats=true 时会额外返回按模型拆分的统计数据（modelStats）
 */
export async function findCustomRangeProviderLeaderboard(
  dateRange: DateRangeParams,
  providerType?: ProviderType,
  includeModelStats?: boolean
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderLeaderboardWithTimezone(
    "custom",
    timezone,
    dateRange,
    providerType,
    includeModelStats
  );
}

/**
 * 查询自定义日期范围供应商缓存命中率排行榜
 */
export async function findCustomRangeProviderCacheHitRateLeaderboard(
  dateRange: DateRangeParams,
  providerType?: ProviderType
): Promise<ProviderCacheHitRateLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findProviderCacheHitRateLeaderboardWithTimezone(
    "custom",
    timezone,
    dateRange,
    providerType
  );
}

/**
 * 查询今日模型调用排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于系统时区
 */
export async function findDailyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findModelLeaderboardWithTimezone("daily", timezone);
}

/**
 * 查询本月模型调用排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于系统时区
 */
export async function findMonthlyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findModelLeaderboardWithTimezone("monthly", timezone);
}

/**
 * 查询本周模型调用排行榜（不限制数量）
 */
export async function findWeeklyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findModelLeaderboardWithTimezone("weekly", timezone);
}

/**
 * 查询全部时间模型调用排行榜（不限制数量）
 */
export async function findAllTimeModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findModelLeaderboardWithTimezone("allTime", timezone);
}

/**
 * 通用模型排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 * 根据系统配置的 billingModelSource 决定使用哪个模型字段进行统计
 */
async function findModelLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams
): Promise<ModelLeaderboardEntry[]> {
  // 获取系统设置中的计费模型来源配置
  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;

  // 根据配置决定模型字段的优先级
  // original: 优先使用 originalModel（用户请求的模型），回退到 model
  // redirected: 优先使用 model（重定向后的实际模型），回退到 originalModel
  const modelField =
    billingModelSource === "original"
      ? sql<string>`COALESCE(${usageLedger.originalModel}, ${usageLedger.model})`
      : sql<string>`COALESCE(${usageLedger.model}, ${usageLedger.originalModel})`;

  const rankings = await db
    .select({
      model: modelField,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${usageLedger.inputTokens} +
          ${usageLedger.outputTokens} +
          COALESCE(${usageLedger.cacheCreationInputTokens}, 0) +
          COALESCE(${usageLedger.cacheReadInputTokens}, 0)
        )::double precision,
        0::double precision
      )`,
      successRate: sql<number>`COALESCE(
        count(CASE WHEN ${usageLedger.isSuccess} THEN 1 END)::double precision
        / NULLIF(count(*)::double precision, 0),
        0::double precision
      )`,
    })
    .from(usageLedger)
    .where(and(LEDGER_BILLING_CONDITION, buildDateCondition(period, timezone, dateRange)))
    .groupBy(modelField)
    .orderBy(desc(sql`count(*)`)); // 按请求数排序

  return rankings
    .filter((entry) => entry.model !== null && entry.model !== "")
    .map((entry) => ({
      model: entry.model as string, // 已过滤 null/空字符串，可安全断言
      totalRequests: entry.totalRequests,
      totalCost: parseFloat(entry.totalCost),
      totalTokens: entry.totalTokens,
      successRate: entry.successRate ?? 0,
    }));
}

/**
 * 查询自定义日期范围模型调用排行榜
 */
export async function findCustomRangeModelLeaderboard(
  dateRange: DateRangeParams
): Promise<ModelLeaderboardEntry[]> {
  const timezone = await resolveSystemTimezone();
  return findModelLeaderboardWithTimezone("custom", timezone, dateRange);
}
