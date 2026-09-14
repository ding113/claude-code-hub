import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import {
  CHANNEL_PROVIDER_ENDPOINTS_UPDATED,
  CHANNEL_PROVIDERS_UPDATED,
  publishCacheInvalidation,
} from "@/lib/redis/pubsub";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import { createKeyedRefreshCache, type KeyedRefreshCacheStats } from "./keyed-refresh-cache";

/**
 * Enabled provider endpoints per (vendorId, providerType), read on every forwarded request.
 *
 * - 30s TTL, invalidated on endpoint and provider mutations (both channels)
 * - Probe result writes do not invalidate: they only change ranking hints, which may lag by at
 *   most one TTL; eligibility (enabled/deleted) only changes through admin paths that publish
 * - Gated by ENABLE_PROVIDER_CACHE together with the provider list cache
 *
 * Callers must treat the returned array as read-only.
 */
const PROVIDER_ENDPOINT_CACHE_TTL_MS = 30_000;
const PROVIDER_ENDPOINT_CACHE_MAX_SIZE = 2_000;

const cache = createKeyedRefreshCache<ProviderEndpoint[]>({
  name: "ProviderEndpointCache",
  ttlMs: PROVIDER_ENDPOINT_CACHE_TTL_MS,
  maxSize: PROVIDER_ENDPOINT_CACHE_MAX_SIZE,
  invalidationChannels: [CHANNEL_PROVIDER_ENDPOINTS_UPDATED, CHANNEL_PROVIDERS_UPDATED],
  isEnabled: () => getEnvConfig().ENABLE_PROVIDER_CACHE,
});

export function getCachedProviderEndpoints(
  vendorId: number,
  providerType: ProviderType,
  fetcher: () => Promise<ProviderEndpoint[]>
): Promise<ProviderEndpoint[]> {
  return cache.get(`${vendorId}:${providerType}`, fetcher);
}

export function invalidateProviderEndpointCache(): void {
  cache.invalidate();
}

/**
 * Invalidate locally and broadcast to other processes. Call after committing endpoint changes.
 */
export async function publishProviderEndpointCacheInvalidation(): Promise<void> {
  cache.invalidate();
  await publishCacheInvalidation(CHANNEL_PROVIDER_ENDPOINTS_UPDATED);
  logger.debug("[ProviderEndpointCache] Published cache invalidation");
}

export function getProviderEndpointCacheStats(): KeyedRefreshCacheStats {
  return cache.getStats();
}

export function resetProviderEndpointCacheForTests(): void {
  cache.resetForTests();
}
