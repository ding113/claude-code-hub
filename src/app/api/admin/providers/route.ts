import { NextRequest, NextResponse } from "next/server";
import { getProviders, addProvider } from "@/actions/providers";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/providers
 * 获取所有供应商列表（管理员）

 */
export async function GET() {
  try {
    const providers = await getProviders();
    return NextResponse.json(providers);
  } catch (error) {
    logger.error("Failed to get providers:", error);
    return NextResponse.json({ error: "获取供应商列表失败" }, { status: 500 });
  }
}

/**
 * POST /api/admin/providers
 * 创建新供应商（管理员）
 *
 * Body: 参见 providers.ts 中的 addProvider 参数

 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await addProvider(body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create provider:", error);
    return NextResponse.json({ error: "创建供应商失败" }, { status: 500 });
  }
}
