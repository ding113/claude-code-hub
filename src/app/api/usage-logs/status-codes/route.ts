import { NextResponse } from "next/server";
import { getStatusCodeList } from "@/actions/usage-logs";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/usage-logs/status-codes
 * 获取状态码列表（用于筛选器）
 *
 * 认证：由 action 内部处理
 */
export async function GET() {
  try {
    const result = await getStatusCodeList();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get status code list:", error);
    return NextResponse.json({ error: "获取状态码列表失败" }, { status: 500 });
  }
}
