"use server";

import { getOverviewMetrics as getOverviewMetricsFromDB } from "@/repository/overview";
import { getConcurrentSessions as getConcurrentSessionsCount } from "./concurrent-sessions";
import { getActiveSessions as getActiveSessionsFromManager } from "./active-sessions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";
import type { ActiveSessionInfo } from "@/types/session";
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

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
  /** 最近活跃的Session列表（用于滚动展示） */
  recentSessions: ActiveSessionInfo[];
}

/**
 * 获取概览数据（首页实时面板使用）
 */
export async function getOverviewData(): Promise<ActionResult<OverviewData>> {
  try {
    // 获取隐私过滤上下文（决定金额计算方式）
    const privacyContext = await getPrivacyContext();

    // 并行查询所有数据
    const [concurrentResult, metricsData, sessionsResult] = await Promise.all([
      getConcurrentSessionsCount(),
      getOverviewMetricsFromDB(privacyContext),
      getActiveSessionsFromManager(),
    ]);

    // 处理并发数（失败时返回0）
    const concurrentSessions = concurrentResult.ok ? concurrentResult.data : 0;

    // 处理Session列表（失败时返回空数组，最多取10个）
    const recentSessions = sessionsResult.ok ? sessionsResult.data.slice(0, 10) : [];

    return {
      ok: true,
      data: {
        concurrentSessions,
        todayRequests: metricsData.todayRequests,
        todayCost: metricsData.todayCost,
        avgResponseTime: metricsData.avgResponseTime,
        recentSessions,
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
