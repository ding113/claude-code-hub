"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getRateLimitEventStats } from "@/repository/statistics";
import type { RateLimitEventFilters, RateLimitEventStats } from "@/types/statistics";
import type { ActionResult } from "./types";

/**
 * 获取限流事件统计数据（仅管理员）
 *
 * @param filters 过滤条件（用户ID、供应商ID、限流类型、时间范围等）
 * @returns 限流事件统计结果
 */
export async function getRateLimitStats(
  filters: RateLimitEventFilters = {}
): Promise<ActionResult<RateLimitEventStats>> {
  try {
    const session = await getSession();

    // 仅管理员可访问
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "Unauthorized - Admin access required",
      };
    }

    // 调用 repository 方法获取统计数据
    const stats = await getRateLimitEventStats(filters);

    logger.info("Rate limit statistics retrieved", {
      userId: session.user.id,
      filters,
      totalEvents: stats.total_events,
    });

    return {
      ok: true,
      data: stats,
    };
  } catch (error) {
    logger.error("Failed to get rate limit statistics", { error, filters });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to get rate limit statistics",
    };
  }
}
