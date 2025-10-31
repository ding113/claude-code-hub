import { NextResponse } from "next/server";
import { getAvailableModelsByProviderType } from "@/actions/model-prices";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/model-prices/models
 * 获取可用模型列表（管理员）

 */
export async function GET() {
  try {
    const models = await getAvailableModelsByProviderType();
    return NextResponse.json(models);
  } catch (error) {
    logger.error("Failed to get available models:", error);
    return NextResponse.json({ error: "获取可用模型列表失败" }, { status: 500 });
  }
}
