import { NextResponse } from "next/server";
import { getConcurrentSessions } from "@/actions/concurrent-sessions";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/sessions/concurrent
 * 获取当前并发 session 数量（需要登录）
 *
 * 认证：需要添加到 action 中
 */
export async function GET() {
  try {
    const result = await getConcurrentSessions();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ count: result.data });
  } catch (error) {
    logger.error("Failed to get concurrent sessions:", error);
    return NextResponse.json({ error: "获取并发数失败" }, { status: 500 });
  }
}
