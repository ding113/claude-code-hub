"use server";

import { getOverviewMetrics as getOverviewMetricsFromDB } from "@/repository/overview";
import { getConcurrentSessions as getConcurrentSessionsCount } from "./concurrent-sessions";
import { getActiveSessions as getActiveSessionsFromManager } from "./active-sessions";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";
import type { ActiveSessionInfo } from "@/types/session";

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
 * ✅ 权限控制：管理员或 allowGlobalUsageView=true 时显示全站数据
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

    // 并行查询所有数据
    const [concurrentResult, metricsData, sessionsResult] = await Promise.all([
      getConcurrentSessionsCount(),
      getOverviewMetricsFromDB(),
      getActiveSessionsFromManager(),
    ]);

    // 根据权限决定显示范围
    if (!canViewGlobalData) {
      // 普通用户且无权限：仅显示自己的活跃 Session，全站指标设为 0
      const recentSessions = sessionsResult.ok ? sessionsResult.data.slice(0, 10) : [];

      logger.debug("Overview: User without global view permission", {
        userId: session.user.id,
        userName: session.user.name,
        ownSessionsCount: recentSessions.length,
      });

      return {
        ok: true,
        data: {
          concurrentSessions: 0, // 无权限时不显示全站并发数
          todayRequests: 0, // 无权限时不显示全站请求数
          todayCost: 0, // 无权限时不显示全站消耗
          avgResponseTime: 0, // 无权限时不显示全站平均响应时间
          recentSessions, // 仅显示自己的活跃 Session（getActiveSessions 已做权限过滤）
        },
      };
    }

    // 管理员或有权限：显示全站数据
    const concurrentSessions = concurrentResult.ok ? concurrentResult.data : 0;
    const recentSessions = sessionsResult.ok ? sessionsResult.data.slice(0, 10) : [];

    logger.debug("Overview: User with global view permission", {
      userId: session.user.id,
      userName: session.user.name,
      isAdmin,
      allowGlobalUsageView: settings.allowGlobalUsageView,
    });

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
