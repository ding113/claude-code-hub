"use server";

import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";

// 导入已有的接口和方法
import { getOverviewData, type OverviewData } from "./overview";
import { getActiveSessions } from "./active-sessions";
import {
  findDailyLeaderboard,
  findDailyProviderLeaderboard,
  findDailyModelLeaderboard,
  type LeaderboardEntry,
  type ProviderLeaderboardEntry,
  type ModelLeaderboardEntry,
} from "@/repository/leaderboard";
import { getProviderSlots, type ProviderSlotInfo } from "./provider-slots";
import { getUserStatistics } from "./statistics";

/**
 * 实时活动流条目
 */
export interface ActivityStreamEntry {
  /** 消息 ID */
  id: string;
  /** 用户名 */
  user: string;
  /** 模型名称 */
  model: string;
  /** 供应商名称 */
  provider: string;
  /** 响应时间（毫秒） */
  latency: number;
  /** HTTP 状态码 */
  status: number;
  /** 成本（美元） */
  cost: number;
  /** 开始时间 */
  startTime: number;
}

/**
 * 数据大屏完整数据
 */
export interface DashboardRealtimeData {
  /** 核心指标 */
  metrics: OverviewData;

  /** 实时活动流（最近20条） */
  activityStream: ActivityStreamEntry[];

  /** 用户排行榜（Top 5） */
  userRankings: LeaderboardEntry[];

  /** 供应商排行榜（Top 5） */
  providerRankings: ProviderLeaderboardEntry[];

  /** 供应商并发插槽状态 */
  providerSlots: ProviderSlotInfo[];

  /** 模型调用分布 */
  modelDistribution: ModelLeaderboardEntry[];

  /** 24小时趋势数据 */
  trendData: Array<{
    hour: number;
    value: number;
  }>;
}

/**
 * 获取数据大屏的所有实时数据
 *
 * 一次性并行查询所有数据源，包括：
 * - 核心指标（并发、请求、成本、响应时间、错误率）
 * - 实时活动流
 * - 用户/供应商/模型排行榜
 * - 供应商并发插槽状态
 * - 24小时趋势
 *
 * 权限控制：管理员或 allowGlobalUsageView=true 时可查看
 */
export async function getDashboardRealtimeData(): Promise<ActionResult<DashboardRealtimeData>> {
  try {
    // 权限检查
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

    if (!canViewGlobalData) {
      logger.debug("DashboardRealtime: User without global view permission", {
        userId: session.user.id,
      });
      return {
        ok: false,
        error: "无权限查看全局数据",
      };
    }

    // 并行查询所有数据源
    const [
      overviewResult,
      activeSessionsResult,
      userRankings,
      providerRankings,
      providerSlotsResult,
      modelRankings,
      statisticsResult,
    ] = await Promise.all([
      getOverviewData(),
      getActiveSessions(),
      findDailyLeaderboard(),
      findDailyProviderLeaderboard(),
      getProviderSlots(),
      findDailyModelLeaderboard(),
      getUserStatistics("today"),
    ]);

    // 检查核心数据是否获取成功
    if (!overviewResult.ok) {
      return {
        ok: false,
        error: overviewResult.error || "获取概览数据失败",
      };
    }

    // 处理实时活动流数据
    const activityStream: ActivityStreamEntry[] = activeSessionsResult.ok
      ? activeSessionsResult.data.slice(0, 20).map((session) => ({
          id: session.sessionId,
          user: session.userName,
          model: session.model || "Unknown",
          provider: session.providerName || "Unknown",
          latency: session.durationMs || 0,
          status: session.statusCode || 200,
          cost: parseFloat(session.costUsd || "0"),
          startTime: session.startTime,
        }))
      : [];

    // 处理供应商插槽数据（合并流量数据）
    const providerSlots: ProviderSlotInfo[] = providerSlotsResult.ok
      ? providerSlotsResult.data.map((slot) => {
          // 从供应商排行榜中找到对应的流量数据
          const rankingData = providerRankings.find((p) => p.providerId === slot.providerId);
          return {
            ...slot,
            totalVolume: rankingData?.totalTokens || 0,
          };
        })
      : [];

    // 处理趋势数据（24小时）
    const trendData =
      statisticsResult.ok && statisticsResult.data?.chartData
        ? statisticsResult.data.chartData.map((item) => ({
            hour: typeof item.hour === "number" ? item.hour : parseInt(String(item.hour), 10),
            value:
              typeof item.requests === "number"
                ? item.requests
                : parseInt(String(item.requests), 10),
          }))
        : Array.from({ length: 24 }, (_, i) => ({ hour: i, value: 0 }));

    logger.debug("DashboardRealtime: Retrieved dashboard data", {
      userId: session.user.id,
      activityCount: activityStream.length,
      userRankingCount: userRankings.length,
      providerRankingCount: providerRankings.length,
      modelCount: modelRankings.length,
    });

    return {
      ok: true,
      data: {
        metrics: overviewResult.data,
        activityStream,
        userRankings: userRankings.slice(0, 5),
        providerRankings: providerRankings.slice(0, 5),
        providerSlots,
        modelDistribution: modelRankings.slice(0, 10), // 前10个模型
        trendData,
      },
    };
  } catch (error) {
    logger.error("Failed to get dashboard realtime data:", error);
    return {
      ok: false,
      error: "获取数据大屏数据失败",
    };
  }
}
