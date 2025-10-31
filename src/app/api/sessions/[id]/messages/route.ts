import { NextRequest, NextResponse } from "next/server";
import { getSessionMessages, hasSessionMessages } from "@/actions/active-sessions";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/sessions/:id/messages
 * 获取 session 的 messages 内容（需要登录）
 *
 * 认证：需要添加到 action 中
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;

    const result = await getSessionMessages(sessionId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get session messages:", error);
    return NextResponse.json({ error: "获取 session messages 失败" }, { status: 500 });
  }
}

/**
 * HEAD /api/sessions/:id/messages
 * 检查是否有 messages 数据（需要登录）
 *
 * 认证：需要添加到 action 中
 */
export async function HEAD(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;

    const result = await hasSessionMessages(sessionId);

    if (!result.ok) {
      return new NextResponse(null, { status: 400 });
    }

    return new NextResponse(null, { status: result.data ? 200 : 404 });
  } catch (error) {
    logger.error("Failed to check session messages:", error);
    return new NextResponse(null, { status: 500 });
  }
}
