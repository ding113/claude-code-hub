import { NextRequest, NextResponse } from "next/server";
import {
  getModelPrices,
  uploadPriceTable,
  syncLiteLLMPrices,
  getAvailableModelsByProviderType,
} from "@/actions/model-prices";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/model-prices
 * 获取所有模型价格（管理员）

 */
export async function GET() {
  try {
    const prices = await getModelPrices();
    return NextResponse.json(prices);
  } catch (error) {
    logger.error("Failed to get model prices:", error);
    return NextResponse.json({ error: "获取模型价格失败" }, { status: 500 });
  }
}

/**
 * POST /api/admin/model-prices
 * 上传价格表（管理员）
 *
 * Body: {
 *   jsonContent: string; // 价格表 JSON 字符串
 * }

 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.jsonContent) {
      return NextResponse.json({ error: "缺少 jsonContent 参数" }, { status: 400 });
    }

    const result = await uploadPriceTable(body.jsonContent);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    logger.error("Failed to upload price table:", error);
    return NextResponse.json({ error: "上传价格表失败" }, { status: 500 });
  }
}
