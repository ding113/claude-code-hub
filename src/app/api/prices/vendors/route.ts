import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/drizzle/db";
import { getSession } from "@/lib/auth";
import { iconFileForVendor } from "@/lib/model-vendor/vendor-icon-files";
import { vendorDisplayName } from "@/lib/model-vendor/vendor-inference";
import type { CloudVendorSummary } from "@/lib/price-sync/cpt-convert";
import { getCloudPricingCatalog } from "@/repository/cloud-pricing-catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices/vendors
 *
 * 云端价格表 vendor 汇总(名称/图标/模型数),用于价格页供应商筛选。
 * 优先读取同步时落库的 cloud_pricing_catalog;目录缺失时降级为对
 * model_prices.price_data->>'vendor' 的去重统计。
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "无权限访问此资源" }, { status: 403 });
  }

  try {
    const catalog = await getCloudPricingCatalog();
    if (catalog && Array.isArray(catalog.vendors) && catalog.vendors.length > 0) {
      return NextResponse.json({
        ok: true,
        data: { vendors: catalog.vendors, version: catalog.version },
      });
    }

    // 降级:目录未同步时从价格表行统计
    const result = await db.execute(sql`
      SELECT price_data->>'vendor' AS vendor, COUNT(DISTINCT model_name) AS count
      FROM model_prices
      WHERE price_data->>'vendor' IS NOT NULL
      GROUP BY price_data->>'vendor'
      ORDER BY COUNT(DISTINCT model_name) DESC
    `);

    const vendors: CloudVendorSummary[] = Array.from(result)
      .map((row) => {
        const vendor = String((row as { vendor?: unknown }).vendor ?? "");
        const icon = iconFileForVendor(vendor);
        return {
          vendor,
          name: vendorDisplayName(vendor),
          ...(icon ? { icon: icon.file, iconMono: icon.mono === true } : {}),
          modelCount: Number((row as { count?: unknown }).count ?? 0),
        };
      })
      .filter((item) => item.vendor);

    return NextResponse.json({ ok: true, data: { vendors, version: null } });
  } catch (error) {
    console.error("获取云端 vendor 列表失败:", error);
    return NextResponse.json({ ok: false, error: "服务器内部错误" }, { status: 500 });
  }
}
