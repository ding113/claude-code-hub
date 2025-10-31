import { NextRequest, NextResponse } from "next/server";
import { getUsers, addUser } from "@/actions/users";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/users
 * 获取所有用户列表（管理员）

 */
export async function GET() {
  try {
    const users = await getUsers();
    return NextResponse.json(users);
  } catch (error) {
    logger.error("Failed to get users:", error);
    return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 });
  }
}

/**
 * POST /api/admin/users
 * 创建新用户（管理员）
 *
 * Body: {
 *   name: string;
 *   note?: string;
 *   providerGroup?: string | null;
 *   rpm?: number;
 *   dailyQuota?: number;
 * }

 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await addUser({
      name: body.name,
      note: body.note,
      providerGroup: body.providerGroup,
      rpm: body.rpm,
      dailyQuota: body.dailyQuota,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create user:", error);
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}
