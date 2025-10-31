import { NextRequest, NextResponse } from "next/server";
import { getKeys, addKey } from "@/actions/keys";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/keys
 * 获取当前用户的密钥列表（普通用户）
 *
 * 说明：action 内部会检查权限，用户只能查看自己的密钥
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const result = await getKeys(session.user.id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get keys:", error);
    return NextResponse.json({ error: "获取密钥列表失败" }, { status: 500 });
  }
}

/**
 * POST /api/keys
 * 创建新密钥（普通用户，自动使用当前用户 ID）
 *
 * Body: {
 *   name: string;
 *   expiresAt?: string;
 *   canLoginWebUi?: boolean;
 *   limit5hUsd?: number | null;
 *   limitWeeklyUsd?: number | null;
 *   limitMonthlyUsd?: number | null;
 *   limitConcurrentSessions?: number;
 * }
 *
 * 说明：action 内部会检查权限，用户只能为自己创建密钥
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await req.json();

    const result = await addKey({
      userId: session.user.id, // 使用当前用户 ID
      name: body.name,
      expiresAt: body.expiresAt,
      canLoginWebUi: body.canLoginWebUi,
      limit5hUsd: body.limit5hUsd,
      limitWeeklyUsd: body.limitWeeklyUsd,
      limitMonthlyUsd: body.limitMonthlyUsd,
      limitConcurrentSessions: body.limitConcurrentSessions,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    logger.error("Failed to create key:", error);
    return NextResponse.json({ error: "创建密钥失败" }, { status: 500 });
  }
}
