import { NextResponse } from "next/server";
import { getSystemSettings } from "@/repository/system-config";

// 需要数据库连接
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system-settings
 * 获取系统设置（包括货币显示配置）
 */
export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to fetch system settings:", error);
    return NextResponse.json({ error: "获取系统设置失败" }, { status: 500 });
  }
}
