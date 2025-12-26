import "server-only";

import { findAllProviders } from "@/repository/provider";
import { findAllVendors } from "@/repository/vendor";
import { findVendorEndpointsByVendorId } from "@/repository/vendor-endpoint";
import { countVendorKeys, findVendorKeysByVendorAndEndpoint } from "@/repository/vendor-key";
import type { Provider } from "@/types/provider";
import type { Vendor, VendorEndpoint, VendorKey } from "@/types/vendor";

function toProviderCompat(params: {
  vendor: Vendor;
  endpoint: VendorEndpoint;
  key: VendorKey;
}): Provider {
  const { vendor, endpoint, key } = params;

  // Flatten the new hierarchy into the legacy Provider interface.
  // - Treat each vendor_key as a Provider row
  // - isEnabled reflects vendor + endpoint + key status (so legacy selector respects new layers)
  return {
    id: key.id,
    name: key.name,
    url: key.url,
    key: key.key,
    isEnabled: vendor.isEnabled && endpoint.isEnabled && key.isEnabled,
    weight: key.weight,

    priority: key.priority,
    costMultiplier: key.costMultiplier,
    groupTag: key.groupTag,

    providerType: key.providerType,
    preserveClientIp: key.preserveClientIp,
    modelRedirects: key.modelRedirects,
    allowedModels: key.allowedModels,
    joinClaudePool: key.joinClaudePool,

    codexInstructionsStrategy: key.codexInstructionsStrategy,
    mcpPassthroughType: key.mcpPassthroughType,
    mcpPassthroughUrl: key.mcpPassthroughUrl,

    limit5hUsd: key.limit5hUsd,
    limitDailyUsd: key.limitDailyUsd,
    dailyResetMode: key.dailyResetMode,
    dailyResetTime: key.dailyResetTime,
    limitWeeklyUsd: key.limitWeeklyUsd,
    limitMonthlyUsd: key.limitMonthlyUsd,
    limitConcurrentSessions: key.limitConcurrentSessions,

    maxRetryAttempts: key.maxRetryAttempts,
    circuitBreakerFailureThreshold: key.circuitBreakerFailureThreshold,
    circuitBreakerOpenDuration: key.circuitBreakerOpenDuration,
    circuitBreakerHalfOpenSuccessThreshold: key.circuitBreakerHalfOpenSuccessThreshold,

    proxyUrl: key.proxyUrl,
    proxyFallbackToDirect: key.proxyFallbackToDirect,

    firstByteTimeoutStreamingMs: key.firstByteTimeoutStreamingMs,
    streamingIdleTimeoutMs: key.streamingIdleTimeoutMs,
    requestTimeoutNonStreamingMs: key.requestTimeoutNonStreamingMs,

    websiteUrl: key.websiteUrl ?? vendor.websiteUrl,
    faviconUrl: key.faviconUrl ?? vendor.faviconUrl,
    cacheTtlPreference: key.cacheTtlPreference,
    context1mPreference: key.context1mPreference,

    tpm: key.tpm,
    rpm: key.rpm,
    rpd: key.rpd,
    cc: key.cc,

    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    deletedAt: key.deletedAt,
  };
}

/**
 * Compatibility layer: map Vendor -> Endpoint -> Key into legacy Provider[].
 *
 * Intended usage:
 * - Allows existing codepaths (selector, forwarder, dashboards) to keep using Provider.
 * - New layers (vendor/endpoint enable flags) are folded into Provider.isEnabled.
 */
export async function findAllProvidersCompat(): Promise<Provider[]> {
  const vendors = await findAllVendors();
  const providers: Provider[] = [];

  for (const vendor of vendors) {
    const endpoints = await findVendorEndpointsByVendorId(vendor.id);

    for (const endpoint of endpoints) {
      const keys = await findVendorKeysByVendorAndEndpoint(vendor.id, endpoint.id);

      for (const key of keys) {
        providers.push(toProviderCompat({ vendor, endpoint, key }));
      }
    }
  }

  // Match the legacy ordering (newest first) as closely as possible.
  providers.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return providers;
}

export async function findAllProvidersHybrid(): Promise<Provider[]> {
  try {
    const vendorKeyCount = await countVendorKeys();

    if (vendorKeyCount > 0) {
      return await findAllProvidersCompat();
    }
  } catch {
    // Backward compatibility: if vendor tables aren't migrated yet, fall back to legacy providers.
  }

  return findAllProviders();
}
