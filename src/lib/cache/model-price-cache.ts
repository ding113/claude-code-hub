import "server-only";

import { logger } from "@/lib/logger";
import { queryLatestPriceByModel } from "@/repository/model-price";
import type { ModelPrice } from "@/types/model-price";
import { modelPriceLookupCache } from "./model-price-invalidation";

/**
 * Read-through cached variant of findLatestPriceByModel for the proxy billing path.
 *
 * - Caches both hits and "no price" results for up to 60s (the alias fallback query that runs for
 *   unknown names is the most expensive lookup, so negative caching matters)
 * - Any price write clears the cache locally and broadcasts invalidation to other processes
 * - Database errors are logged and reported as null without being cached, matching the
 *   non-cached lookup's contract
 */
export async function findLatestPriceByModelCached(modelName: string): Promise<ModelPrice | null> {
  try {
    return await modelPriceLookupCache.get(modelName, () => queryLatestPriceByModel(modelName));
  } catch (error) {
    logger.error("[ModelPriceCache] Failed to query latest price by model", {
      modelName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
