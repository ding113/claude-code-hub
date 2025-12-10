import { logger } from "@/lib/logger";
import type { DailyLeaderboardData } from "@/lib/wechat/message-templates";
import { findLast24HoursLeaderboard } from "@/repository/leaderboard";

/**
 * 生成每日排行榜数据（过去24小时）
 * @param topN 显示前 N 名用户
 * @returns 排行榜数据
 */
export async function generateDailyLeaderboard(topN: number): Promise<DailyLeaderboardData | null> {
  try {
    logger.info({
      action: "generate_daily_leaderboard",
      topN,
    });

    // 获取过去24小时排行榜
    const leaderboard = await findLast24HoursLeaderboard();

    if (!leaderboard || leaderboard.length === 0) {
      logger.info({ action: "daily_leaderboard_empty" });
      return null;
    }

    // 限制前 N 名
    const topEntries = leaderboard.slice(0, topN);

    // 计算总计
    const totalRequests = leaderboard.reduce((sum, entry) => sum + entry.totalRequests, 0);
    const totalCost = leaderboard.reduce((sum, entry) => sum + entry.totalCost, 0);

    // 格式化日期 (YYYY-MM-DD)
    const today = new Date();
    const dateStr = today
      .toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");

    return {
      date: dateStr,
      entries: topEntries.map((entry) => ({
        userId: entry.userId,
        userName: entry.userName,
        totalRequests: entry.totalRequests,
        totalCost: entry.totalCost,
        totalTokens: entry.totalTokens,
      })),
      totalRequests,
      totalCost,
    };
  } catch (error) {
    logger.error({
      action: "generate_daily_leaderboard_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
