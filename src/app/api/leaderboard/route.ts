import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getLeaderboardWithCache } from "@/lib/redis";
import { getSystemSettings } from "@/repository/system-config";
import { formatCurrency } from "@/lib/utils";
import { getSession } from "@/lib/auth";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取排行榜数据
 * GET /api/leaderboard?period=daily|monthly
 *
 * 需要认证，普通用户需要 allowGlobalUsageView 权限
 * 实时计算 + Redis 乐观缓存（60 秒 TTL）
 */
export async function GET(request: NextRequest) {
  try {
    // 获取用户 session
    const session = await getSession();
    if (!session) {
      logger.warn("Leaderboard API: Unauthorized access attempt");
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    // 获取系统配置
    const systemSettings = await getSystemSettings();

    // 检查权限：管理员或开启了全站使用量查看权限
    const isAdmin = session.user.role === "admin";
    const hasPermission = isAdmin || systemSettings.allowGlobalUsageView;

    if (!hasPermission) {
      logger.warn("Leaderboard API: Access denied", {
        userId: session.user.id,
        userName: session.user.name,
        isAdmin,
        allowGlobalUsageView: systemSettings.allowGlobalUsageView,
      });
      return NextResponse.json(
        { error: "无权限访问排行榜，请联系管理员开启全站使用量查看权限" },
        { status: 403 }
      );
    }

    // 验证参数
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get("period") || "daily";

    if (period !== "daily" && period !== "monthly") {
      return NextResponse.json(
        { error: "参数 period 必须是 'daily' 或 'monthly'" },
        { status: 400 }
      );
    }

    // 使用 Redis 乐观缓存获取数据
    const rawData = await getLeaderboardWithCache(period, systemSettings.currencyDisplay);

    // 格式化金额字段
    const data = rawData.map((entry) => ({
      ...entry,
      totalCostFormatted: formatCurrency(entry.totalCost, systemSettings.currencyDisplay),
    }));

    logger.info("Leaderboard API: Access granted", {
      userId: session.user.id,
      userName: session.user.name,
      isAdmin: session.user.role === "admin",
      period,
      entriesCount: data.length,
    });

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
