import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { CHANNEL_MODEL_PRICES_UPDATED, publishCacheInvalidation } from "@/lib/redis/pubsub";
import type { ModelPrice } from "@/types/model-price";
import { createKeyedRefreshCache, type KeyedRefreshCacheStats } from "./keyed-refresh-cache";

/**
 * Storage and invalidation for the model price lookup cache.
 *
 * Kept separate from the read-through helper so the price repository can schedule invalidation
 * after writes without an import cycle (repository -> invalidation, cache helper -> repository).
 */
const MODEL_PRICE_CACHE_TTL_MS = 60_000;
const MODEL_PRICE_CACHE_MAX_SIZE = 5_000;
/** Bulk imports and cloud syncs write many rows; coalesce the cross-process broadcast. */
export const MODEL_PRICE_INVALIDATION_PUBLISH_DEBOUNCE_MS = 200;

export const modelPriceLookupCache = createKeyedRefreshCache<ModelPrice | null>({
  name: "ModelPriceCache",
  ttlMs: MODEL_PRICE_CACHE_TTL_MS,
  maxSize: MODEL_PRICE_CACHE_MAX_SIZE,
  invalidationChannels: [CHANNEL_MODEL_PRICES_UPDATED],
  isEnabled: () => getEnvConfig().ENABLE_MODEL_PRICE_CACHE,
});

let publishTimer: NodeJS.Timeout | null = null;

export function invalidateModelPriceCache(): void {
  modelPriceLookupCache.invalidate();
}

/**
 * Clear this process's price cache immediately and broadcast a (debounced) invalidation so other
 * processes converge well before the TTL. Safe to call once per written row.
 */
export function scheduleModelPriceCacheInvalidation(): void {
  modelPriceLookupCache.invalidate();
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publishCacheInvalidation(CHANNEL_MODEL_PRICES_UPDATED);
  }, MODEL_PRICE_INVALIDATION_PUBLISH_DEBOUNCE_MS);
  publishTimer.unref?.();
}

export function getModelPriceCacheStats(): KeyedRefreshCacheStats {
  return modelPriceLookupCache.getStats();
}

export function resetModelPriceCacheForTests(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  modelPriceLookupCache.resetForTests();
}
