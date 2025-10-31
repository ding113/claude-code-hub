import { NextRequest, NextResponse } from "next/server";
import { editUser, removeUser } from "@/actions/users";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * PATCH /api/admin/users/:id
 * 编辑用户信息（管理员）
 *
 * Body: {
 *   name?: string;
 *   note?: string;
 *   providerGroup?: string | null;
 *   rpm?: number;
 *   dailyQuota?: number;
 * }

 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = parseInt(params.id, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "无效的用户 ID" }, { status: 400 });
    }

    const body = await req.json();

    const result = await editUser(userId, {
      name: body.name,
      note: body.note,
      providerGroup: body.providerGroup,
      rpm: body.rpm,
      dailyQuota: body.dailyQuota,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to edit user:", error);
    return NextResponse.json({ error: "编辑用户失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/:id
 * 删除用户（管理员）

 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = parseInt(params.id, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "无效的用户 ID" }, { status: 400 });
    }

    const result = await removeUser(userId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete user:", error);
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
