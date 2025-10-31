import { NextRequest, NextResponse } from "next/server";
import { getUsageLogs, getModelList, getStatusCodeList } from "@/actions/usage-logs";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/usage-logs
 * 获取使用日志（根据权限过滤）
 *
 * Query参数：page, limit, model, status, keyId, startDate, endDate
 * 注意：userId 由 action 根据用户权限自动处理（管理员可查看所有，用户仅查看自己的）
 *
 * 认证：由 action 内部处理
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    // 注意：不传递 userId，action 内部会根据权限自动处理
    const filters = {
      page: parseInt(searchParams.get("page") || "1", 10),
      pageSize: parseInt(searchParams.get("limit") || "50", 10),
      model: searchParams.get("model") || undefined,
      statusCode: searchParams.get("status") ? parseInt(searchParams.get("status")!, 10) : undefined,
      keyId: searchParams.get("keyId") ? parseInt(searchParams.get("keyId")!, 10) : undefined,
      startDate: searchParams.get("startDate") ? new Date(searchParams.get("startDate")!) : undefined,
      endDate: searchParams.get("endDate") ? new Date(searchParams.get("endDate")!) : undefined,
    };

    const result = await getUsageLogs(filters);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get usage logs:", error);
    return NextResponse.json({ error: "获取使用日志失败" }, { status: 500 });
  }
}
