import { NextResponse } from "next/server";
import { getUserLimitUsage } from "@/actions/users";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/users/me/limits
 * 获取当前用户的限额使用情况（普通用户）
 *
 * 说明：getUserLimitUsage() 内部会检查权限，用户只能查看自己的限额
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const result = await getUserLimitUsage(session.user.id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get user limit usage:", error);
    return NextResponse.json({ error: "获取用户限额失败" }, { status: 500 });
  }
}
