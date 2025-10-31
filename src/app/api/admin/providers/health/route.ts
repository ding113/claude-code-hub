import { NextResponse } from "next/server";
import { getProvidersHealthStatus } from "@/actions/providers";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/providers/health
 * 获取所有供应商的熔断器健康状态（管理员）

 */
export async function GET() {
  try {
    const healthStatus = await getProvidersHealthStatus();
    return NextResponse.json(healthStatus);
  } catch (error) {
    logger.error("Failed to get providers health status:", error);
    return NextResponse.json({ error: "获取熔断器状态失败" }, { status: 500 });
  }
}
