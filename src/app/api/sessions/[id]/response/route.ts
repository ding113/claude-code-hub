import { NextRequest, NextResponse } from "next/server";
import { getSessionResponse } from "@/actions/session-response";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/sessions/:id/response
 * 获取 session 响应体内容（需要登录）
 *
 * 认证：需要添加到 action 中
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;

    const result = await getSessionResponse(sessionId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ response: result.data });
  } catch (error) {
    logger.error("Failed to get session response:", error);
    return NextResponse.json({ error: "获取 session 响应体失败" }, { status: 500 });
  }
}
