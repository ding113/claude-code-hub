import { NextRequest, NextResponse } from "next/server";
import { editKey, removeKey } from "@/actions/keys";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * PATCH /api/keys/:id
 * 编辑密钥信息（普通用户，仅自己的密钥）
 *
 * 说明：action 内部会检查权限，用户只能编辑自己的密钥
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
 * DELETE /api/keys/:id
 * 删除密钥（普通用户，仅自己的密钥）
 *
 * 说明：action 内部会检查权限，用户只能删除自己的密钥
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
