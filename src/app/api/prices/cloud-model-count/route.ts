import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fetchAndParseCloudPriceTable } from "@/lib/price-sync/cloud-price-table";

export async function GET() {
  // 权限检查：只有管理员可以访问
  const session = await getSession();
  if (session?.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "无权限访问此资源" }, { status: 403 });
  }

  const parseResult = await fetchAndParseCloudPriceTable();
  if (!parseResult.ok) {
    return NextResponse.json({ ok: false, error: parseResult.error }, { status: 502 });
  }

  const count = parseResult.data.models.length;
  return NextResponse.json({ ok: true, data: { count, version: parseResult.data.version } });
}
