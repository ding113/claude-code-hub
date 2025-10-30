import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getLeaderboardWithCache } from "@/lib/redis";
import { getSystemSettings } from "@/repository/system-config";
import { formatCurrency } from "@/lib/utils";
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取排行榜数据
 * GET /api/leaderboard?period=daily|monthly
 *
 * 无需认证，公开访问（但会根据用户权限返回不同的金额）
 * 实时计算 + Redis 乐观缓存（60 秒 TTL）
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

    // 获取隐私过滤上下文（决定金额计算方式）
    const privacyContext = await getPrivacyContext();

    // 使用 Redis 乐观缓存获取数据（根据隐私上下文返回不同的金额）
    const rawData = await getLeaderboardWithCache(
      period,
      systemSettings.currencyDisplay,
      privacyContext
    );

    // 格式化金额字段（使用用户对应的货币符号）
    const data = rawData.map((entry) => ({
      ...entry,
      totalCostFormatted: formatCurrency(entry.totalCost, privacyContext.userCurrency),
    }));

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    logger.error("获取排行榜失败:", error);
    return NextResponse.json({ error: "获取排行榜数据失败" }, { status: 500 });
  }
}
