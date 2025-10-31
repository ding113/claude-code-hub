import { NextRequest, NextResponse } from "next/server";
import { updateSensitiveWordAction, deleteSensitiveWordAction } from "@/actions/sensitive-words";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * PATCH /api/admin/sensitive-words/:id
 * 更新敏感词（管理员）
 *
 * 认证：由 action 内部处理
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "无效的敏感词 ID" }, { status: 400 });
    }

    const body = await req.json();
    const result = await updateSensitiveWordAction(id, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to update sensitive word:", error);
    return NextResponse.json({ error: "更新敏感词失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/sensitive-words/:id
 * 删除敏感词（管理员）
 *
 * 认证：由 action 内部处理
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "无效的敏感词 ID" }, { status: 400 });
    }

    const result = await deleteSensitiveWordAction(id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete sensitive word:", error);
    return NextResponse.json({ error: "删除敏感词失败" }, { status: 500 });
  }
}
