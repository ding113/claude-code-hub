"use server";

import { and, avg, count, eq, gte, isNull, sql, sum } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";
import { EXCLUDE_WARMUP_CONDITION } from "./_shared/message-request-conditions";

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
 * 带同比的概览数据
 */
export interface OverviewMetricsWithComparison extends OverviewMetrics {
  /** 昨日同时段请求数 */
  yesterdaySamePeriodRequests: number;
  /** 昨日同时段消耗 */
  yesterdaySamePeriodCost: number;
  /** 昨日同时段平均响应时间 */
  yesterdaySamePeriodAvgResponseTime: number;
  /** 最近1分钟请求数 (RPM) */
  recentMinuteRequests: number;
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
        EXCLUDE_WARMUP_CONDITION,
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

/**
 * 获取带昨日同时段对比的概览数据
 * 昨日同时段：昨天 00:00 到昨天的当前时刻
 * @param userId 可选用户ID，传入时只统计该用户的数据
 */
export async function getOverviewMetricsWithComparison(
  userId?: number
): Promise<OverviewMetricsWithComparison> {
  const timezone = getEnvConfig().TZ;

  // 用户过滤条件
  const userCondition = userId ? eq(messageRequest.userId, userId) : undefined;

  // 并行查询今日数据、昨日同时段数据、最近1分钟数据
  const [todayResult, yesterdayResult, rpmResult] = await Promise.all([
    // 今日数据（从今日 00:00 到现在）
    db
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
          EXCLUDE_WARMUP_CONDITION,
          userCondition,
          sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
        )
      ),

    // 昨日同时段数据（昨日 00:00 到昨日的当前时刻）
    db
      .select({
        requestCount: count(),
        totalCost: sum(messageRequest.costUsd),
        avgDuration: avg(messageRequest.durationMs),
      })
      .from(messageRequest)
      .where(
        and(
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          userCondition,
          // 昨日同一天
          sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = ((CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '1 day')::date`,
          // 且时间不超过昨日的当前时刻
          sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::time <= (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::time`
        )
      ),

    // 最近1分钟请求数 (RPM)
    db
      .select({
        requestCount: count(),
      })
      .from(messageRequest)
      .where(
        and(
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          userCondition,
          gte(messageRequest.createdAt, sql`CURRENT_TIMESTAMP - INTERVAL '1 minute'`)
        )
      ),
  ]);

  const today = todayResult[0];
  const yesterday = yesterdayResult[0];
  const rpm = rpmResult[0];

  // 处理今日数据
  const todayCostDecimal = toCostDecimal(today.totalCost) ?? new Decimal(0);
  const todayCost = todayCostDecimal.toDecimalPlaces(6).toNumber();
  const todayAvgResponseTime = today.avgDuration ? Math.round(Number(today.avgDuration)) : 0;
  const todayRequestCount = Number(today.requestCount || 0);
  const todayErrorCount = Number(today.errorCount || 0);
  const todayErrorRate =
    todayRequestCount > 0
      ? parseFloat(((todayErrorCount / todayRequestCount) * 100).toFixed(2))
      : 0;

  // 处理昨日同时段数据
  const yesterdayCostDecimal = toCostDecimal(yesterday.totalCost) ?? new Decimal(0);
  const yesterdaySamePeriodCost = yesterdayCostDecimal.toDecimalPlaces(6).toNumber();
  const yesterdaySamePeriodAvgResponseTime = yesterday.avgDuration
    ? Math.round(Number(yesterday.avgDuration))
    : 0;
  const yesterdaySamePeriodRequests = Number(yesterday.requestCount || 0);

  return {
    todayRequests: todayRequestCount,
    todayCost,
    avgResponseTime: todayAvgResponseTime,
    todayErrorRate,
    yesterdaySamePeriodRequests,
    yesterdaySamePeriodCost,
    yesterdaySamePeriodAvgResponseTime,
    recentMinuteRequests: Number(rpm.requestCount || 0),
  };
}
