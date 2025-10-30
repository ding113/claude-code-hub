"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users } from "@/drizzle/schema";
import { and, gte, lt, desc, sql, isNull } from "drizzle-orm";
import { buildSumCostExpression } from "./_shared/cost-calculator";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";

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
 *
 * @param privacyContext 隐私过滤上下文（决定是否包含倍率）
 */
export async function findDailyLeaderboard(
  privacyContext: PrivacyFilterContext
): Promise<LeaderboardEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return findLeaderboard(today, tomorrow, privacyContext);
}

/**
 * 查询本月消耗排行榜（不限制数量）
 *
 * @param privacyContext 隐私过滤上下文（决定是否包含倍率）
 */
export async function findMonthlyLeaderboard(
  privacyContext: PrivacyFilterContext
): Promise<LeaderboardEntry[]> {
  const today = new Date();
  const startTime = new Date(today.getFullYear(), today.getMonth(), 1);
  const endTime = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  return findLeaderboard(startTime, endTime, privacyContext);
}

/**
 * 通用排行榜查询函数（不限制返回数量）
 *
 * @param startTime 开始时间
 * @param endTime 结束时间
 * @param privacyContext 隐私过滤上下文（决定金额计算方式）
 */
async function findLeaderboard(
  startTime: Date,
  endTime: Date,
  privacyContext: PrivacyFilterContext
): Promise<LeaderboardEntry[]> {
  // 构建条件化的成本计算表达式
  const costExpression = buildSumCostExpression(privacyContext);

  const rankings = await db
    .select({
      userId: messageRequest.userId,
      userName: users.name,
      totalRequests: sql<number>`count(*)::int`,
      // 使用条件化的金额计算：管理员或不忽略倍率时包含倍率，否则仅计算原始成本
      totalCost: sql<string>`COALESCE(${costExpression}, 0)`,
      totalTokens: sql<number>`COALESCE(
        sum(
          ${messageRequest.inputTokens} +
          ${messageRequest.outputTokens} +
          COALESCE(${messageRequest.cacheCreationInputTokens}, 0) +
          COALESCE(${messageRequest.cacheReadInputTokens}, 0)
        ), 0
      )::int`,
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
    // 排序也使用相同的条件化表达式
    .orderBy(desc(costExpression));
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
