import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getLeaderboardWithCache } from "@/lib/redis";
import type {
  DateRangeParams,
  LeaderboardPeriod,
  LeaderboardScope,
} from "@/lib/redis/leaderboard-cache";
import { formatCurrency } from "@/lib/utils";
import { getSystemSettings } from "@/repository/system-config";

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime", "custom"];

// 日期格式校验正则 (YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取排行榜数据
 * GET /api/leaderboard?period=daily|weekly|monthly|allTime|custom&scope=user|provider|model
 * 当 period=custom 时，需要提供 startDate 和 endDate 参数 (YYYY-MM-DD 格式)
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
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

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

    // 验证自定义日期范围参数
    let dateRange: DateRangeParams | undefined;
    if (period === "custom") {
      if (!startDate || !endDate) {
        return NextResponse.json(
          { error: "当 period=custom 时，必须提供 startDate 和 endDate 参数" },
          { status: 400 }
        );
      }
      if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
        return NextResponse.json({ error: "日期格式必须是 YYYY-MM-DD" }, { status: 400 });
      }
      if (new Date(startDate) > new Date(endDate)) {
        return NextResponse.json({ error: "startDate 不能大于 endDate" }, { status: 400 });
      }
      dateRange = { startDate, endDate };
    }

    // 使用 Redis 乐观缓存获取数据
    const rawData = await getLeaderboardWithCache(
      period,
      systemSettings.currencyDisplay,
      scope,
      dateRange
    );

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
      dateRange,
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
