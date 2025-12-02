"use server";

import { and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, providers, users } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config";
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
 * 供应商排行榜条目类型
 */
export interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number; // 0-1 之间的小数，UI 层负责格式化为百分比
  avgResponseTime: number; // 毫秒
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
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于配置时区（Asia/Shanghai）
 */
export async function findDailyLeaderboard(): Promise<LeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findLeaderboardWithTimezone("daily", timezone);
}

/**
 * 查询本月消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于配置时区（Asia/Shanghai）
 */
export async function findMonthlyLeaderboard(): Promise<LeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findLeaderboardWithTimezone("monthly", timezone);
}

/**
 * 查询本周消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本周"基于配置时区
 */
export async function findWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findLeaderboardWithTimezone("weekly", timezone);
}

/**
 * 查询全部时间消耗排行榜（不限制数量）
 */
export async function findAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findLeaderboardWithTimezone("allTime", timezone);
}

/**
 * 排行榜周期类型
 */
export type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "allTime" | "custom";

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
  if (period === "custom" && dateRange) {
    // 自定义日期范围：startDate <= date <= endDate
    return sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date >= ${dateRange.startDate}::date
      AND (${messageRequest.createdAt} AT TIME ZONE ${timezone})::date <= ${dateRange.endDate}::date`;
  }

  switch (period) {
    case "allTime":
      return sql`1=1`;
    case "daily":
      return sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`;
    case "weekly":
      return sql`date_trunc('week', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})`;
    case "monthly":
      return sql`date_trunc('month', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})`;
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
  dateRange?: DateRangeParams
): Promise<LeaderboardEntry[]> {
  const rankings = await db
    .select({
      userId: messageRequest.userId,
      userName: users.name,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${messageRequest.inputTokens} +
          ${messageRequest.outputTokens} +
          COALESCE(${messageRequest.cacheCreationInputTokens}, 0) +
          COALESCE(${messageRequest.cacheReadInputTokens}, 0)
        )::double precision,
        0::double precision
      )`,
    })
    .from(messageRequest)
    .innerJoin(users, and(sql`${messageRequest.userId} = ${users.id}`, isNull(users.deletedAt)))
    .where(and(isNull(messageRequest.deletedAt), buildDateCondition(period, timezone, dateRange)))
    .groupBy(messageRequest.userId, users.name)
    .orderBy(desc(sql`sum(${messageRequest.costUsd})`));

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
  dateRange: DateRangeParams
): Promise<LeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findLeaderboardWithTimezone("custom", timezone, dateRange);
}

/**
 * 查询今日供应商消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于配置时区（Asia/Shanghai）
 */
export async function findDailyProviderLeaderboard(): Promise<ProviderLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findProviderLeaderboardWithTimezone("daily", timezone);
}

/**
 * 查询本月供应商消耗排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于配置时区（Asia/Shanghai）
 */
export async function findMonthlyProviderLeaderboard(): Promise<ProviderLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findProviderLeaderboardWithTimezone("monthly", timezone);
}

/**
 * 查询本周供应商消耗排行榜（不限制数量）
 */
export async function findWeeklyProviderLeaderboard(): Promise<ProviderLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findProviderLeaderboardWithTimezone("weekly", timezone);
}

/**
 * 查询全部时间供应商消耗排行榜（不限制数量）
 */
export async function findAllTimeProviderLeaderboard(): Promise<ProviderLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findProviderLeaderboardWithTimezone("allTime", timezone);
}

/**
 * 通用供应商排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 */
async function findProviderLeaderboardWithTimezone(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams
): Promise<ProviderLeaderboardEntry[]> {
  const rankings = await db
    .select({
      providerId: messageRequest.providerId,
      providerName: providers.name,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${messageRequest.inputTokens} +
          ${messageRequest.outputTokens} +
          COALESCE(${messageRequest.cacheCreationInputTokens}, 0) +
          COALESCE(${messageRequest.cacheReadInputTokens}, 0)
        )::double precision,
        0::double precision
      )`,
      successRate: sql<number>`COALESCE(
        count(CASE WHEN ${messageRequest.errorMessage} IS NULL OR ${messageRequest.errorMessage} = '' THEN 1 END)::double precision
        / NULLIF(count(*)::double precision, 0),
        0::double precision
      )`,
      avgResponseTime: sql<number>`COALESCE(avg(${messageRequest.durationMs})::double precision, 0::double precision)`,
    })
    .from(messageRequest)
    .innerJoin(
      providers,
      and(sql`${messageRequest.providerId} = ${providers.id}`, isNull(providers.deletedAt))
    )
    .where(and(isNull(messageRequest.deletedAt), buildDateCondition(period, timezone, dateRange)))
    .groupBy(messageRequest.providerId, providers.name)
    .orderBy(desc(sql`sum(${messageRequest.costUsd})`));

  return rankings.map((entry) => ({
    providerId: entry.providerId,
    providerName: entry.providerName,
    totalRequests: entry.totalRequests,
    totalCost: parseFloat(entry.totalCost),
    totalTokens: entry.totalTokens,
    successRate: entry.successRate ?? 0,
    avgResponseTime: entry.avgResponseTime ?? 0,
  }));
}

/**
 * 查询自定义日期范围供应商消耗排行榜
 */
export async function findCustomRangeProviderLeaderboard(
  dateRange: DateRangeParams
): Promise<ProviderLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findProviderLeaderboardWithTimezone("custom", timezone, dateRange);
}

/**
 * 查询今日模型调用排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"今日"基于配置时区（Asia/Shanghai）
 */
export async function findDailyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findModelLeaderboardWithTimezone("daily", timezone);
}

/**
 * 查询本月模型调用排行榜（不限制数量）
 * 使用 SQL AT TIME ZONE 进行时区转换，确保"本月"基于配置时区（Asia/Shanghai）
 */
export async function findMonthlyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findModelLeaderboardWithTimezone("monthly", timezone);
}

/**
 * 查询本周模型调用排行榜（不限制数量）
 */
export async function findWeeklyModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
  return findModelLeaderboardWithTimezone("weekly", timezone);
}

/**
 * 查询全部时间模型调用排行榜（不限制数量）
 */
export async function findAllTimeModelLeaderboard(): Promise<ModelLeaderboardEntry[]> {
  const timezone = getEnvConfig().TZ;
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
      ? sql<string>`COALESCE(${messageRequest.originalModel}, ${messageRequest.model})`
      : sql<string>`COALESCE(${messageRequest.model}, ${messageRequest.originalModel})`;

  const rankings = await db
    .select({
      model: modelField,
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${messageRequest.inputTokens} +
          ${messageRequest.outputTokens} +
          COALESCE(${messageRequest.cacheCreationInputTokens}, 0) +
          COALESCE(${messageRequest.cacheReadInputTokens}, 0)
        )::double precision,
        0::double precision
      )`,
      successRate: sql<number>`COALESCE(
        count(CASE WHEN ${messageRequest.errorMessage} IS NULL OR ${messageRequest.errorMessage} = '' THEN 1 END)::double precision
        / NULLIF(count(*)::double precision, 0),
        0::double precision
      )`,
    })
    .from(messageRequest)
    .where(and(isNull(messageRequest.deletedAt), buildDateCondition(period, timezone, dateRange)))
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
  const timezone = getEnvConfig().TZ;
  return findModelLeaderboardWithTimezone("custom", timezone, dateRange);
}
