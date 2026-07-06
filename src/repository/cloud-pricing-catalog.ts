"use server";

import { desc, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { cloudPricingCatalog } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type { CloudVendorSummary } from "@/lib/price-sync/cpt-convert";
import type { CptProviderInfo } from "@/lib/price-sync/cpt-schema";

export interface CloudPricingCatalogRecord {
  version: string;
  currency: string;
  refreshedAt: Date | null;
  providers: Record<string, CptProviderInfo>;
  vendors: CloudVendorSummary[];
  modelCount: number;
  syncedAt: Date | null;
}

export interface CloudPricingCatalogInput {
  version: string;
  currency: string;
  refreshedAt: string | null;
  providers: Record<string, CptProviderInfo>;
  vendors: CloudVendorSummary[];
  modelCount: number;
}

/** 单行 upsert:目录元数据只保留最新一份 */
export async function upsertCloudPricingCatalog(input: CloudPricingCatalogInput): Promise<void> {
  const parsed = input.refreshedAt ? new Date(input.refreshedAt) : null;
  // refreshedAt 以 ISO 字符串 + 显式 ::timestamptz 绑定,不让 JS Date 进驱动参数路径
  const refreshedAtIso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
  // providers 字典上游用 Object.create(null) 构建(防原型污染),
  // 但 drizzle 的 is() 会对参数取 Object.getPrototypeOf(value).constructor,null 原型直接抛错
  const providers = { ...input.providers };
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM cloud_pricing_catalog`);
    await tx.insert(cloudPricingCatalog).values({
      version: input.version,
      currency: input.currency,
      refreshedAt: refreshedAtIso ? sql`${refreshedAtIso}::timestamptz` : null,
      providers,
      vendors: input.vendors,
      modelCount: input.modelCount,
    });
  });
}

export async function getCloudPricingCatalog(): Promise<CloudPricingCatalogRecord | null> {
  try {
    // 并发同步竞态下可能残留多行,固定取最新一条保证读取确定性
    const [row] = await db
      .select()
      .from(cloudPricingCatalog)
      .orderBy(desc(cloudPricingCatalog.id))
      .limit(1);
    if (!row) return null;
    return {
      version: row.version,
      currency: row.currency,
      refreshedAt: row.refreshedAt,
      providers: (row.providers ?? {}) as Record<string, CptProviderInfo>,
      vendors: (row.vendors ?? []) as CloudVendorSummary[],
      modelCount: row.modelCount,
      syncedAt: row.syncedAt,
    };
  } catch (error) {
    // 表尚未迁移等场景不阻断调用方(返回 null 走兜底)
    logger.warn("[CloudPricingCatalog] Failed to read catalog", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
