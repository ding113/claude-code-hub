"use server";

import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { eq, isNull, and } from "drizzle-orm";
import { SessionTracker } from "@/lib/session-tracker";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";

/**
 * 供应商并发插槽信息
 */
export interface ProviderSlotInfo {
  /** 供应商 ID */
  providerId: number;
  /** 供应商名称 */
  name: string;
  /** 当前已使用插槽数（活跃 Session 数） */
  usedSlots: number;
  /** 总插槽数（并发限制） */
  totalSlots: number;
  /** 总 Token 流量（从排行榜获取） */
  totalVolume: number;
}

/**
 * 获取所有供应商的并发插槽状态
 * 用于数据大屏显示供应商实时负载情况
 *
 * 权限控制：管理员或 allowGlobalUsageView=true 时可查看
 */
export async function getProviderSlots(): Promise<ActionResult<ProviderSlotInfo[]>> {
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
      logger.debug("ProviderSlots: User without global view permission", {
        userId: session.user.id,
      });
      return {
        ok: false,
        error: "无权限查看全局数据",
      };
    }

    // 查询所有启用的供应商
    const providerList = await db
      .select({
        id: providers.id,
        name: providers.name,
        limitConcurrentSessions: providers.limitConcurrentSessions,
      })
      .from(providers)
      .where(and(eq(providers.isEnabled, true), isNull(providers.deletedAt)))
      .orderBy(providers.priority, providers.id);

    // 并行获取每个供应商的并发数
    const slotInfoList = await Promise.all(
      providerList.map(
        async (provider: { id: number; name: string; limitConcurrentSessions: number | null }) => {
          const usedSlots = await SessionTracker.getProviderSessionCount(provider.id);

          return {
            providerId: provider.id,
            name: provider.name,
            usedSlots,
            totalSlots: provider.limitConcurrentSessions ?? 0,
            totalVolume: 0, // This will be populated by the calling action from leaderboard data.
          };
        }
      )
    );

    logger.debug("ProviderSlots: Retrieved provider slots", {
      userId: session.user.id,
      providerCount: slotInfoList.length,
    });

    return {
      ok: true,
      data: slotInfoList,
    };
  } catch (error) {
    logger.error("Failed to get provider slots:", error);
    return {
      ok: false,
      error: "获取供应商插槽信息失败",
    };
  }
}
