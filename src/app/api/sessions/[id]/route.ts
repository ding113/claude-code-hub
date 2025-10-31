import { NextRequest, NextResponse } from "next/server";
import { getSessionDetails } from "@/actions/active-sessions";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/sessions/:id
 * 获取 session 完整详情（需要登录）
 *
 * 认证：需要添加到 action 中
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;

    const result = await getSessionDetails(sessionId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get session details:", error);
    return NextResponse.json({ error: "获取 session 详情失败" }, { status: 500 });
  }
}
