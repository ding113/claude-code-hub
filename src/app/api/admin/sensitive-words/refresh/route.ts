import { NextResponse } from "next/server";
import { refreshCacheAction } from "@/actions/sensitive-words";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * POST /api/admin/sensitive-words/refresh
 * 手动刷新敏感词缓存（管理员）
 *
 * 认证：由 action 内部处理
 */
export async function POST() {
  try {
    const result = await refreshCacheAction();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to refresh cache:", error);
    return NextResponse.json({ error: "刷新缓存失败" }, { status: 500 });
  }
}
