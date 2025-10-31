import { NextRequest, NextResponse } from "next/server";
import { getKeys, addKey } from "@/actions/keys";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/keys?userId=:userId
 * 获取指定用户的密钥列表（管理员）

 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const userIdParam = searchParams.get("userId");

    if (!userIdParam) {
      return NextResponse.json({ error: "缺少 userId 参数" }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "无效的用户 ID" }, { status: 400 });
    }

    const result = await getKeys(userId);

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
 * POST /api/admin/keys
 * 创建新密钥（管理员，可指定 userId）
 *
 * Body: {
 *   userId: number;
 *   name: string;
 *   expiresAt?: string;
 *   canLoginWebUi?: boolean;
 *   limit5hUsd?: number | null;
 *   limitWeeklyUsd?: number | null;
 *   limitMonthlyUsd?: number | null;
 *   limitConcurrentSessions?: number;
 * }

 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await addKey({
      userId: body.userId,
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
