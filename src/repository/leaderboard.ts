"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users } from "@/drizzle/schema";
import { and, gte, lt, desc, sql, isNull } from "drizzle-orm";

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
 * 查询今日消耗排行榜（不限制数量）
 */
export async function findDailyLeaderboard(): Promise<LeaderboardEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return findLeaderboard(today, tomorrow);
}

/**
 * 查询本月消耗排行榜（不限制数量）
 */
export async function findMonthlyLeaderboard(): Promise<LeaderboardEntry[]> {
  const today = new Date();
  const startTime = new Date(today.getFullYear(), today.getMonth(), 1);
  const endTime = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  return findLeaderboard(startTime, endTime);
}

/**
 * 通用排行榜查询函数（不限制返回数量）
 */
async function findLeaderboard(startTime: Date, endTime: Date): Promise<LeaderboardEntry[]> {
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
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime)
      )
    )
    .groupBy(messageRequest.userId, users.name)
    .orderBy(desc(sql`sum(${messageRequest.costUsd})`));
  // 移除 .limit(50)，不限制返回数量

  // 将 totalCost 从字符串转为数字
  return rankings.map((entry) => ({
    userId: entry.userId,
    userName: entry.userName,
    totalRequests: entry.totalRequests,
    totalCost: parseFloat(entry.totalCost),
    totalTokens: entry.totalTokens,
  }));
}
