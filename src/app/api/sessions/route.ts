import { NextResponse } from "next/server";
import { getActiveSessions, getAllSessions } from "@/actions/active-sessions";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/sessions?all=true
 * 获取活跃 session 列表或所有 session（需要登录）
 *
 * Query参数：all - 是否获取所有 session（包括非活跃的）
 *
 * 认证：需要添加到 action 中
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeAll = url.searchParams.get("all") === "true";

    const result = includeAll ? await getAllSessions() : await getActiveSessions();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get sessions:", error);
    return NextResponse.json({ error: "获取 session 列表失败" }, { status: 500 });
  }
}
