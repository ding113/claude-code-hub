import { NextResponse } from "next/server";
import { getOverviewData } from "@/actions/overview";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/overview
 * 获取概览数据（首页实时面板使用）
 *
 * 认证：由 action 内部处理（需要登录）
 */
export async function GET() {
  try {
    const result = await getOverviewData();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get overview data:", error);
    return NextResponse.json({ error: "获取概览数据失败" }, { status: 500 });
  }
}
