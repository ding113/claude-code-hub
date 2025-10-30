"use server";

import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { isNull, and, gte, lt, count, avg, sql } from "drizzle-orm";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";

/**
 * 今日概览统计数据
 */
export interface OverviewMetrics {
  /** 今日总请求数 */
  todayRequests: number;
  /** 今日总消耗（美元） */
  todayCost: number;
  /** 平均响应时间（毫秒） */
  avgResponseTime: number;
}

/**
 * 构建条件化的金额聚合表达式
 * 用于概览统计
 */
function buildSumCostExpression(context: PrivacyFilterContext) {
  // 管理员或不忽略倍率：SUM(cost_usd * cost_multiplier)
  if (context.isAdmin || !context.ignoreMultiplier) {
    return sql<string>`SUM(${messageRequest.costUsd} * COALESCE(${messageRequest.costMultiplier}, 1.0))`;
  }
  // 非管理员且忽略倍率：SUM(cost_usd)
  return sql<string>`SUM(${messageRequest.costUsd})`;
}

/**
 * 获取今日概览统计数据
 * 包括：今日总请求数、今日总消耗、平均响应时间
 *
 * @param privacyContext 隐私过滤上下文（决定金额计算方式）
 */
export async function getOverviewMetrics(privacyContext: PrivacyFilterContext): Promise<OverviewMetrics> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const costExpression = buildSumCostExpression(privacyContext);

  const [result] = await db
    .select({
      requestCount: count(),
      totalCost: costExpression,
      avgDuration: avg(messageRequest.durationMs),
    })
    .from(messageRequest)
    .where(
      and(
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, today),
        lt(messageRequest.createdAt, tomorrow)
      )
    );

  // 处理成本数据
  const costDecimal = toCostDecimal(result.totalCost) ?? new Decimal(0);
  const todayCost = costDecimal.toDecimalPlaces(6).toNumber();

  // 处理平均响应时间（转换为整数）
  const avgResponseTime = result.avgDuration ? Math.round(Number(result.avgDuration)) : 0;

  return {
    todayRequests: Number(result.requestCount || 0),
    todayCost,
    avgResponseTime,
  };
}
