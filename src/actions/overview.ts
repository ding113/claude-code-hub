"use server";

import { getOverviewMetrics as getOverviewMetricsFromDB } from "@/repository/overview";
import { getConcurrentSessions as getConcurrentSessionsCount } from "./concurrent-sessions";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { logger } from "@/lib/logger";
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
}

/**
 * 获取概览数据（首页实时面板使用）
 * 权限控制：管理员或 allowGlobalUsageView=true 时显示全站数据
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
    const [concurrentResult, metricsData] = await Promise.all([
      getConcurrentSessionsCount(),
      getOverviewMetricsFromDB(),
    ]);

    // 根据权限决定显示范围
    if (!canViewGlobalData) {
      // 普通用户且无权限：全站指标设为 0
      logger.debug("Overview: User without global view permission", {
        userId: session.user.id,
        userName: session.user.name,
      });

      return {
        ok: true,
        data: {
          concurrentSessions: 0, // 无权限时不显示全站并发数
          todayRequests: 0, // 无权限时不显示全站请求数
          todayCost: 0, // 无权限时不显示全站消耗
          avgResponseTime: 0, // 无权限时不显示全站平均响应时间
          todayErrorRate: 0, // 无权限时不显示全站错误率
        },
      };
    }

    // 管理员或有权限：显示全站数据
    const concurrentSessions = concurrentResult.ok ? concurrentResult.data : 0;

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
        todayErrorRate: metricsData.todayErrorRate,
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
