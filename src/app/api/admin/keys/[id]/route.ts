import { NextRequest, NextResponse } from "next/server";
import { editKey, removeKey } from "@/actions/keys";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * PATCH /api/admin/keys/:id
 * 编辑密钥信息（管理员）

 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const keyId = parseInt(params.id, 10);
    if (isNaN(keyId)) {
      return NextResponse.json({ error: "无效的密钥 ID" }, { status: 400 });
    }

    const body = await req.json();
    const result = await editKey(keyId, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to edit key:", error);
    return NextResponse.json({ error: "编辑密钥失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/keys/:id
 * 删除密钥（管理员）

 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const keyId = parseInt(params.id, 10);
    if (isNaN(keyId)) {
      return NextResponse.json({ error: "无效的密钥 ID" }, { status: 400 });
    }

    const result = await removeKey(keyId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete key:", error);
    return NextResponse.json({ error: "删除密钥失败" }, { status: 500 });
  }
}
