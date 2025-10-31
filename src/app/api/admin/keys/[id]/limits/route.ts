import { NextRequest, NextResponse } from "next/server";
import { getKeyLimitUsage } from "@/actions/keys";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/keys/:id/limits
 * 获取密钥限额使用情况（管理员）
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) {
      return NextResponse.json({ error: "无效的密钥 ID" }, { status: 400 });
    }

    const result = await getKeyLimitUsage(keyId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get key limit usage:", error);
    return NextResponse.json({ error: "获取密钥限额失败" }, { status: 500 });
  }
}
