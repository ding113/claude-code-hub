import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * 获取所有用户的代理状态
 * GET /api/proxy-status
 *
 * 认证：需要登录
 *
 * 响应格式：
 * {
 *   users: [
 *     {
 *       userId: number,
 *       userName: string,
 *       activeCount: number,
 *       activeRequests: [...],
 *       lastRequest: {...} | null
 *     }
 *   ]
 * }
 */
export async function GET() {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未授权，请先登录" }, { status: 401 });
    }

    // 权限检查：仅 admin 用户可访问
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 获取代理状态
    const tracker = ProxyStatusTracker.getInstance();
    const status = await tracker.getAllUsersStatus();

    return NextResponse.json(status);
  } catch (error) {
    logger.error("Failed to get proxy status:", error);
    return NextResponse.json({ error: "获取代理状态失败" }, { status: 500 });
  }
}
