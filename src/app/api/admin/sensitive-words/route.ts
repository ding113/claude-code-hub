import { NextRequest, NextResponse } from "next/server";
import {
  listSensitiveWords,
  createSensitiveWordAction,
  getCacheStats,
} from "@/actions/sensitive-words";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/sensitive-words
 * 获取敏感词列表（管理员）
 *
 * 认证：由 action 内部处理
 */
export async function GET() {
  try {
    const words = await listSensitiveWords();
    return NextResponse.json(words);
  } catch (error) {
    logger.error("Failed to get sensitive words:", error);
    return NextResponse.json({ error: "获取敏感词列表失败" }, { status: 500 });
  }
}

/**
 * POST /api/admin/sensitive-words
 * 创建敏感词（管理员）
 *
 * Body: {
 *   word: string;
 *   matchType: "contains" | "exact" | "regex";
 *   description?: string;
 * }
 *
 * 认证：由 action 内部处理
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createSensitiveWordAction({
      word: body.word,
      matchType: body.matchType,
      description: body.description,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    logger.error("Failed to create sensitive word:", error);
    return NextResponse.json({ error: "创建敏感词失败" }, { status: 500 });
  }
}
