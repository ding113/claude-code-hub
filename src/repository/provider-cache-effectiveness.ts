import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerCacheEffectiveness } from "@/drizzle/schema";
import type { ProviderCacheEffectivenessWindow } from "@/types/provider-cache-effectiveness";

export interface ListProviderCacheEffectivenessOptions {
  providerId?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listProviderCacheEffectivenessWindows(
  options: ListProviderCacheEffectivenessOptions = {}
): Promise<ProviderCacheEffectivenessWindow[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(providerCacheEffectiveness)
    .where(
      options.providerId === undefined
        ? undefined
        : eq(providerCacheEffectiveness.providerId, options.providerId)
    )
    .orderBy(desc(providerCacheEffectiveness.windowEnd), desc(providerCacheEffectiveness.id))
    .limit(limit);
  return rows;
}
