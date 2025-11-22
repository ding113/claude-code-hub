"use server";

import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { isNull, and, gte, lt, count, sum, avg, sql } from "drizzle-orm";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";

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
  /** 今日错误率（百分比） */
  todayErrorRate: number;
}

/**
 * 获取今日概览统计数据
 * 包括：今日总请求数、今日总消耗、平均响应时间
 */
export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [result] = await db
    .select({
      requestCount: count(),
      totalCost: sum(messageRequest.costUsd),
      avgDuration: avg(messageRequest.durationMs),
      errorCount: sum(sql<number>`CASE WHEN ${messageRequest.statusCode} >= 400 THEN 1 ELSE 0 END`),
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

  // 计算错误率（百分比）
  const requestCount = Number(result.requestCount || 0);
  const errorCount = Number(result.errorCount || 0);
  const todayErrorRate =
    requestCount > 0 ? parseFloat(((errorCount / requestCount) * 100).toFixed(2)) : 0;

  return {
    todayRequests: requestCount,
    todayCost,
    avgResponseTime,
    todayErrorRate,
  };
}
