import { NextRequest, NextResponse } from "next/server";
import { getUserStatistics } from "@/actions/statistics";
import { logger } from "@/lib/logger";
import type { TimeRange } from "@/types/statistics";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/statistics?timeRange=7d
 * 获取统计数据（管理员看所有，用户看自己）
 *
 * 认证：由 action 内部处理
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const timeRange = (searchParams.get("timeRange") || "7d") as TimeRange;

    const result = await getUserStatistics(timeRange);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get statistics:", error);
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
