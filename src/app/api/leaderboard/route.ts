import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { findDailyLeaderboard, findMonthlyLeaderboard } from "@/repository/leaderboard";
import { getSystemSettings } from "@/repository/system-config";
import { formatCurrency } from "@/lib/utils";
import { unstable_cache } from "next/cache";

/**
 * 获取排行榜数据
 * GET /api/leaderboard?period=daily|monthly
 *
 * 无需认证，公开访问
 * 缓存时间：5 分钟
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get("period") || "daily";

    // 验证参数
    if (period !== "daily" && period !== "monthly") {
      return NextResponse.json(
        { error: "参数 period 必须是 'daily' 或 'monthly'" },
        { status: 400 }
      );
    }

    // 获取系统配置（货币显示单位）
    const systemSettings = await getSystemSettings();

    // 生成缓存 key（包含日期和货币配置以确保每天/每月/货币变化时自动刷新）
    const now = new Date();
    const cacheKey =
      period === "daily"
        ? `leaderboard:daily:${now.toISOString().split("T")[0]}:${systemSettings.currencyDisplay}`
        : `leaderboard:monthly:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}:${systemSettings.currencyDisplay}`;

    // 使用 Next.js unstable_cache 进行缓存
    const getCachedLeaderboard = unstable_cache(
      async () => {
        const rawData =
          period === "daily" ? await findDailyLeaderboard() : await findMonthlyLeaderboard();

        // 格式化金额字段
        return rawData.map((entry) => ({
          ...entry,
          totalCostFormatted: formatCurrency(entry.totalCost, systemSettings.currencyDisplay),
        }));
      },
      [cacheKey],
      {
        revalidate: 300, // 5 分钟缓存
        tags: [`leaderboard-${period}`],
      }
    );

    const data = await getCachedLeaderboard();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    logger.error("获取排行榜失败:", error);
    return NextResponse.json({ error: "获取排行榜数据失败" }, { status: 500 });
  }
}
