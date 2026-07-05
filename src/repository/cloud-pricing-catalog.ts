"use server";

import { sql } from "drizzle-orm";
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
  const refreshedAt = input.refreshedAt ? new Date(input.refreshedAt) : null;
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM cloud_pricing_catalog`);
    await tx.insert(cloudPricingCatalog).values({
      version: input.version,
      currency: input.currency,
      refreshedAt: refreshedAt && !Number.isNaN(refreshedAt.getTime()) ? refreshedAt : null,
      providers: input.providers,
      vendors: input.vendors,
      modelCount: input.modelCount,
    });
  });
}

export async function getCloudPricingCatalog(): Promise<CloudPricingCatalogRecord | null> {
  try {
    const [row] = await db.select().from(cloudPricingCatalog).limit(1);
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
