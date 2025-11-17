"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users, providers } from "@/drizzle/schema";
import { and, desc, sql, isNull } from "drizzle-orm";
import { getEnvConfig } from "@/lib/config";

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
 * 通用排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 */
async function findLeaderboardWithTimezone(
  period: "daily" | "monthly",
  timezone: string
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
    .where(
      and(
        isNull(messageRequest.deletedAt),
        period === "daily"
          ? sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
          : sql`date_trunc('month', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})`
      )
    )
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
 * 通用供应商排行榜查询函数（使用 SQL AT TIME ZONE 确保时区正确）
 */
async function findProviderLeaderboardWithTimezone(
  period: "daily" | "monthly",
  timezone: string
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
    .where(
      and(
        isNull(messageRequest.deletedAt),
        period === "daily"
          ? sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
          : sql`date_trunc('month', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})`
      )
    )
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
