import { NextRequest, NextResponse } from "next/server";
import { editProvider, removeProvider } from "@/actions/providers";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * PATCH /api/admin/providers/:id
 * 编辑供应商信息（管理员）

 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const providerId = parseInt(params.id, 10);
    if (isNaN(providerId)) {
      return NextResponse.json({ error: "无效的供应商 ID" }, { status: 400 });
    }

    const body = await req.json();
    const result = await editProvider(providerId, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to edit provider:", error);
    return NextResponse.json({ error: "编辑供应商失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/providers/:id
 * 删除供应商（管理员）

 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const providerId = parseInt(params.id, 10);
    if (isNaN(providerId)) {
      return NextResponse.json({ error: "无效的供应商 ID" }, { status: 400 });
    }

    const result = await removeProvider(providerId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete provider:", error);
    return NextResponse.json({ error: "删除供应商失败" }, { status: 500 });
  }
}
