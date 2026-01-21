"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getOverviewMetricsWithComparison } from "@/repository/overview";
import { getSystemSettings } from "@/repository/system-config";
import { getConcurrentSessions as getConcurrentSessionsCount } from "./concurrent-sessions";
import type { ActionResult } from "./types";

/**
 * 概览数据（包含并发数和今日统计）
 */
export interface OverviewData {
  /** 当前并发数 */
  concurrentSessions: number;
  /** 今日总请求数 */
  todayRequests: number;
  /** 今日总消耗（美元） */
  todayCost: number;
  /** 平均响应时间（毫秒） */
  avgResponseTime: number;
  /** 今日错误率（百分比） */
  todayErrorRate: number;
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
 * 获取概览数据（首页实时面板使用）
 * 权限控制：
 * - 管理员或 allowGlobalUsageView=true 时显示全站数据
 * - 否则显示当前用户自己的数据
 */
export async function getOverviewData(): Promise<ActionResult<OverviewData>> {
  try {
    // 获取用户 session 和系统设置
    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    const settings = await getSystemSettings();
    const isAdmin = session.user.role === "admin";
    const canViewGlobalData = isAdmin || settings.allowGlobalUsageView;

    // 根据权限决定查询范围
    const userId = canViewGlobalData ? undefined : session.user.id;

    // 并行查询所有数据
    const [concurrentResult, metricsData] = await Promise.all([
      // 并发数只有管理员能看全站的
      isAdmin ? getConcurrentSessionsCount() : Promise.resolve({ ok: true as const, data: 0 }),
      getOverviewMetricsWithComparison(userId),
    ]);

    const concurrentSessions = concurrentResult.ok ? concurrentResult.data : 0;

    logger.debug("Overview: Fetching data", {
      userId: session.user.id,
      userName: session.user.name,
      isAdmin,
      canViewGlobalData,
      queryScope: userId ? "user" : "global",
    });

    return {
      ok: true,
      data: {
        concurrentSessions,
        todayRequests: metricsData.todayRequests,
        todayCost: metricsData.todayCost,
        avgResponseTime: metricsData.avgResponseTime,
        todayErrorRate: metricsData.todayErrorRate,
        yesterdaySamePeriodRequests: metricsData.yesterdaySamePeriodRequests,
        yesterdaySamePeriodCost: metricsData.yesterdaySamePeriodCost,
        yesterdaySamePeriodAvgResponseTime: metricsData.yesterdaySamePeriodAvgResponseTime,
        recentMinuteRequests: metricsData.recentMinuteRequests,
      },
    };
  } catch (error) {
    logger.error("Failed to get overview data:", error);
    return {
      ok: false,
      error: "获取概览数据失败",
    };
  }
}
