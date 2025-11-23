"use server";

import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { isNull, and, count, sum, avg, sql } from "drizzle-orm";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";
import { getEnvConfig } from "@/lib/config";

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
 * 包括：今日总请求数、今日总消耗、平均响应时间、今日错误率
 * 使用 SQL AT TIME ZONE 确保"今日"基于配置时区（TZ 环境变量）
 */
export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const timezone = getEnvConfig().TZ;

  const [result] = await db
    .select({
      requestCount: count(),
      totalCost: sum(messageRequest.costUsd),
      avgDuration: avg(messageRequest.durationMs),
      errorCount: sql<number>`count(*) FILTER (WHERE ${messageRequest.statusCode} >= 400)`,
    })
    .from(messageRequest)
    .where(
      and(
        isNull(messageRequest.deletedAt),
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
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
