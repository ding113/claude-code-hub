import { NextResponse } from "next/server";
import { syncLiteLLMPrices } from "@/actions/model-prices";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * POST /api/admin/model-prices/sync
 * 同步 LiteLLM 价格表（管理员）

 */
export async function POST() {
  try {
    const result = await syncLiteLLMPrices();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to sync LiteLLM prices:", error);
    return NextResponse.json({ error: "同步价格表失败" }, { status: 500 });
  }
}
