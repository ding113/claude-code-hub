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
import { findRecentActivityStream } from "@/repository/activity-stream";

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

// Constants for data limits
const ACTIVITY_STREAM_LIMIT = 20;
const MODEL_DISTRIBUTION_LIMIT = 10;

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

    // 并行查询所有数据源（使用 allSettled 以实现部分失败容错）
    const [
      overviewResult,
      activityStreamResult,
      userRankingsResult,
      providerRankingsResult,
      providerSlotsResult,
      modelRankingsResult,
      statisticsResult,
    ] = await Promise.allSettled([
      getOverviewData(),
      findRecentActivityStream(ACTIVITY_STREAM_LIMIT), // 使用新的混合数据源
      findDailyLeaderboard(),
      findDailyProviderLeaderboard(),
      getProviderSlots(),
      findDailyModelLeaderboard(),
      getUserStatistics("today"),
    ]);

    // 提取数据并处理错误
    const overviewData =
      overviewResult.status === "fulfilled" && overviewResult.value.ok
        ? overviewResult.value.data
        : null;

    if (!overviewData) {
      const errorReason =
        overviewResult.status === "rejected" ? overviewResult.reason : "Unknown error";
      logger.error("Failed to get overview data", { reason: errorReason });
      return {
        ok: false,
        error: "获取概览数据失败",
      };
    }

    // 提取其他数据，失败时使用空数组作为 fallback
    const activityStreamItems =
      activityStreamResult.status === "fulfilled" ? activityStreamResult.value : [];

    const userRankings = userRankingsResult.status === "fulfilled" ? userRankingsResult.value : [];

    const providerRankings =
      providerRankingsResult.status === "fulfilled" ? providerRankingsResult.value : [];

    const providerSlots =
      providerSlotsResult.status === "fulfilled" && providerSlotsResult.value.ok
        ? providerSlotsResult.value.data
        : [];

    const modelRankings =
      modelRankingsResult.status === "fulfilled" ? modelRankingsResult.value : [];

    const statisticsData =
      statisticsResult.status === "fulfilled" && statisticsResult.value.ok
        ? statisticsResult.value.data
        : null;

    // 记录部分失败的数据源
    if (activityStreamResult.status === "rejected" || !activityStreamItems.length) {
      logger.warn("Failed to get activity stream", {
        reason:
          activityStreamResult.status === "rejected" ? activityStreamResult.reason : "empty data",
      });
    }
    if (userRankingsResult.status === "rejected") {
      logger.warn("Failed to get user rankings", { reason: userRankingsResult.reason });
    }
    if (providerRankingsResult.status === "rejected") {
      logger.warn("Failed to get provider rankings", { reason: providerRankingsResult.reason });
    }
    if (providerSlotsResult.status === "rejected" || !providerSlots.length) {
      logger.warn("Failed to get provider slots", {
        reason:
          providerSlotsResult.status === "rejected"
            ? providerSlotsResult.reason
            : "empty data or action failed",
      });
    }
    if (modelRankingsResult.status === "rejected") {
      logger.warn("Failed to get model rankings", { reason: modelRankingsResult.reason });
    }
    if (statisticsResult.status === "rejected" || !statisticsData) {
      logger.warn("Failed to get statistics", {
        reason:
          statisticsResult.status === "rejected"
            ? statisticsResult.reason
            : "action failed or empty data",
      });
    }

    // 处理实时活动流数据（已包含 Redis 活跃 + 数据库最新的混合数据）
    const now = Date.now();
    const activityStream: ActivityStreamEntry[] = activityStreamItems.map((item) => {
      // 计算耗时：
      // - 如果有 durationMs（已完成的请求），使用实际值
      // - 如果没有（进行中的请求），计算从开始到现在的耗时
      const latency = item.durationMs ?? now - item.startTime;

      return {
        id: item.sessionId ?? `req-${item.id}`, // 使用 sessionId，如果没有则用请求ID
        user: item.userName,
        model: item.originalModel ?? item.model ?? "Unknown", // 优先使用计费模型
        provider: item.providerName ?? "Unknown",
        latency,
        status: item.statusCode ?? 200,
        cost: parseFloat(item.costUsd ?? "0"),
        startTime: item.startTime,
      };
    });

    // 处理供应商插槽数据（合并流量数据 + 过滤未设置限额 + 按占用率排序 + 限制最多3个）
    const providerSlotsWithVolume: ProviderSlotInfo[] = providerSlots
      .filter((slot) => slot.totalSlots > 0) // 过滤未设置并发限额的供应商
      .map((slot) => {
        const rankingData = providerRankings.find((p) => p.providerId === slot.providerId);

        if (!rankingData) {
          logger.debug("Provider has slots but no traffic", {
            providerId: slot.providerId,
            providerName: slot.name,
          });
        }

        return {
          ...slot,
          totalVolume: rankingData?.totalTokens ?? 0,
        };
      })
      .sort((a, b) => {
        // 按占用率降序排序（占用率 = usedSlots / totalSlots）
        const usageA = a.totalSlots > 0 ? a.usedSlots / a.totalSlots : 0;
        const usageB = b.totalSlots > 0 ? b.usedSlots / b.totalSlots : 0;
        return usageB - usageA;
      })
      .slice(0, 3); // 只取前3个

    // 处理趋势数据（24小时）- 从 ChartDataItem 正确提取数据
    const trendData = statisticsData?.chartData
      ? statisticsData.chartData.map((item) => {
          const hour = new Date(item.date).getUTCHours();
          // 聚合所有 *_calls 字段（如 user-1_calls, user-2_calls）
          const value = Object.keys(item)
            .filter((key) => key.endsWith("_calls"))
            .reduce((sum, key) => sum + (Number(item[key]) || 0), 0);
          return { hour, value };
        })
      : Array.from({ length: 24 }, (_, i) => ({ hour: i, value: 0 }));

    logger.debug("DashboardRealtime: Retrieved dashboard data", {
      userId: session.user.id,
      concurrentSessions: overviewData.concurrentSessions,
      activityStreamCount: activityStream.length,
      userRankingCount: userRankings.length,
      providerRankingCount: providerRankings.length,
      providerSlotsCount: providerSlotsWithVolume.length,
      modelCount: modelRankings.length,
    });

    // 供应商排行按金额降序排序
    const sortedProviderRankings = [...providerRankings]
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 5);

    return {
      ok: true,
      data: {
        metrics: overviewData,
        activityStream,
        userRankings: userRankings.slice(0, 5),
        providerRankings: sortedProviderRankings,
        providerSlots: providerSlotsWithVolume,
        modelDistribution: modelRankings.slice(0, MODEL_DISTRIBUTION_LIMIT),
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
