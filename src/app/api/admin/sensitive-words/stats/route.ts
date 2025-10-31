import { NextResponse } from "next/server";
import { getCacheStats } from "@/actions/sensitive-words";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/sensitive-words/stats
 * 获取敏感词缓存统计信息（管理员）
 *
 * 认证：由 action 内部处理
 */
export async function GET() {
  try {
    const stats = await getCacheStats();
    return NextResponse.json(stats);
  } catch (error) {
    logger.error("Failed to get cache stats:", error);
    return NextResponse.json({ error: "获取缓存统计失败" }, { status: 500 });
  }
}
