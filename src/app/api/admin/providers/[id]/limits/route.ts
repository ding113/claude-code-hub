import { NextRequest, NextResponse } from "next/server";
import { getProviderLimitUsage } from "@/actions/providers";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/providers/:id/limits
 * 获取供应商限额使用情况（管理员）

 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const providerId = parseInt(params.id, 10);
    if (isNaN(providerId)) {
      return NextResponse.json({ error: "无效的供应商 ID" }, { status: 400 });
    }

    const result = await getProviderLimitUsage(providerId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to get provider limit usage:", error);
    return NextResponse.json({ error: "获取供应商限额失败" }, { status: 500 });
  }
}
