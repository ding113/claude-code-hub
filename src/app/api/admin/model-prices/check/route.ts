import { NextResponse } from "next/server";
import { hasPriceTable } from "@/actions/model-prices";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/model-prices/check
 * 检查是否有价格表（管理员）

 */
export async function GET() {
  try {
    const has = await hasPriceTable();
    return NextResponse.json({ hasPriceTable: has });
  } catch (error) {
    logger.error("Failed to check price table:", error);
    return NextResponse.json({ error: "检查价格表失败" }, { status: 500 });
  }
}
