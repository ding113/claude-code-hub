import { NextResponse } from "next/server";
import { getUsers, getUserLimitUsage } from "@/actions/users";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/users/me
 * 获取当前用户信息（普通用户）
 *
 * 说明：getUsers() 内部会根据 session 判断，普通用户只能看到自己的数据
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const users = await getUsers();

    // 普通用户只会返回一个元素（自己），管理员会返回所有用户
    if (users.length === 0) {
      return NextResponse.json({ error: "未找到用户信息" }, { status: 404 });
    }

    // 返回第一个用户（普通用户的情况）或完整列表（管理员的情况）
    if (session.user.role === "user") {
      return NextResponse.json(users[0]);
    }

    return NextResponse.json(users);
  } catch (error) {
    logger.error("Failed to get current user:", error);
    return NextResponse.json({ error: "获取用户信息失败" }, { status: 500 });
  }
}
