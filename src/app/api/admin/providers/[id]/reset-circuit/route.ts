import { NextRequest, NextResponse } from "next/server";
import { resetProviderCircuit } from "@/actions/providers";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * POST /api/admin/providers/:id/reset-circuit
 * 重置供应商的熔断器状态（管理员）

 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const providerId = parseInt(params.id, 10);
    if (isNaN(providerId)) {
      return NextResponse.json({ error: "无效的供应商 ID" }, { status: 400 });
    }

    const result = await resetProviderCircuit(providerId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to reset circuit:", error);
    return NextResponse.json({ error: "重置熔断器失败" }, { status: 500 });
  }
}
