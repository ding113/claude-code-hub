import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getLeaderboardWithCache } from "@/lib/redis";
import type { LeaderboardPeriod, LeaderboardScope } from "@/lib/redis/leaderboard-cache";
import { formatCurrency } from "@/lib/utils";
import { getSystemSettings } from "@/repository/system-config";

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime"];

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取排行榜数据
 * GET /api/leaderboard?period=daily|monthly&scope=user|provider|model
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
    const period = (searchParams.get("period") || "daily") as LeaderboardPeriod;
    const scope = (searchParams.get("scope") as LeaderboardScope) || "user"; // 向后兼容：默认 user

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        { error: `参数 period 必须是 ${VALID_PERIODS.join(", ")} 之一` },
        { status: 400 }
      );
    }

    if (scope !== "user" && scope !== "provider" && scope !== "model") {
      return NextResponse.json(
        { error: "参数 scope 必须是 'user'、'provider' 或 'model'" },
        { status: 400 }
      );
    }

    // 供应商榜和模型榜仅管理员可见
    if ((scope === "provider" || scope === "model") && !isAdmin) {
      return NextResponse.json(
        { error: scope === "provider" ? "仅管理员可查看供应商排行榜" : "仅管理员可查看模型排行榜" },
        { status: 403 }
      );
    }

    // 使用 Redis 乐观缓存获取数据
    const rawData = await getLeaderboardWithCache(period, systemSettings.currencyDisplay, scope);

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
      scope,
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
