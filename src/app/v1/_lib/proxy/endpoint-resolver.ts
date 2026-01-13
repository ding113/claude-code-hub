import "server-only";

import { isEndpointCircuitOpen, openVendorTypeFuse } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { findProviderEndpointsByVendorType } from "@/repository/provider-endpoint";
import type { Provider, ProviderEndpoint } from "@/types/provider";
import type { ProxySession } from "./session";

const ENDPOINTS_CACHE_TTL_MS = 30_000;

type EndpointsCacheEntry = {
  expiresAt: number;
  endpoints: ProviderEndpoint[];
};

const endpointsCache = new Map<string, EndpointsCacheEntry>();

function getCacheKey(vendorId: number, providerType: Provider["providerType"]): string {
  return `${vendorId}:${providerType}`;
}

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function getEndpointsCached(
  vendorId: number,
  providerType: Provider["providerType"]
): Promise<ProviderEndpoint[]> {
  const now = Date.now();
  const key = getCacheKey(vendorId, providerType);
  const cached = endpointsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.endpoints;
  }

  const endpoints = await findProviderEndpointsByVendorType(vendorId, providerType);
  endpointsCache.set(key, { expiresAt: now + ENDPOINTS_CACHE_TTL_MS, endpoints });
  return endpoints;
}

function weightedRandom(endpoints: ProviderEndpoint[]): ProviderEndpoint {
  const totalWeight = endpoints.reduce((sum, e) => sum + (e.weight ?? 0), 0);

  if (totalWeight <= 0) {
    const index = Math.floor(Math.random() * endpoints.length);
    return endpoints[Math.max(0, Math.min(index, endpoints.length - 1))];
  }

  const random = Math.random() * totalWeight;
  let cumulativeWeight = 0;

  for (const endpoint of endpoints) {
    cumulativeWeight += endpoint.weight ?? 0;
    if (random < cumulativeWeight) {
      return endpoint;
    }
  }

  return endpoints[endpoints.length - 1];
}

export class EndpointResolutionError extends Error {
  constructor(
    message: string,
    public readonly vendorId: number,
    public readonly providerType: Provider["providerType"]
  ) {
    super(message);
    this.name = "EndpointResolutionError";
  }
}

export type EndpointResolverSession = Pick<ProxySession, "setProviderEndpoint">;

export class EndpointResolver {
  static async resolve(session: EndpointResolverSession, provider: Provider): Promise<string> {
    const fallback = provider.url;

    if (!provider.vendorId) {
      session.setProviderEndpoint(null);
      return fallback;
    }

    const vendorId = provider.vendorId;
    const providerType = provider.providerType;

    const allEndpoints = await getEndpointsCached(vendorId, providerType);

    if (allEndpoints.length === 0) {
      session.setProviderEndpoint(null);
      return fallback;
    }

    const enabledEndpoints = allEndpoints.filter((e) => e.isEnabled);
    const validEnabledEndpoints = enabledEndpoints.filter((e) => isValidBaseUrl(e.baseUrl));

    if (enabledEndpoints.length > 0 && validEnabledEndpoints.length === 0) {
      logger.warn("[EndpointResolver] All enabled endpoints have invalid baseUrl", {
        vendorId,
        providerType,
        enabledCount: enabledEndpoints.length,
      });
    }

    if (validEnabledEndpoints.length === 0) {
      session.setProviderEndpoint(null);
      openVendorTypeFuse({ vendorId, providerType, reason: "no_enabled_endpoints" });
      throw new EndpointResolutionError("No enabled endpoints", vendorId, providerType);
    }

    const healthyEndpoints = validEnabledEndpoints.filter((e) => !isEndpointCircuitOpen(e.id));

    if (healthyEndpoints.length === 0) {
      session.setProviderEndpoint(null);
      openVendorTypeFuse({ vendorId, providerType, reason: "all_endpoints_unhealthy" });
      throw new EndpointResolutionError("All endpoints unhealthy", vendorId, providerType);
    }

    const minPriority = Math.min(...healthyEndpoints.map((e) => e.priority ?? 0));
    const topPriority = healthyEndpoints.filter((e) => (e.priority ?? 0) === minPriority);

    const selected = weightedRandom(topPriority);

    session.setProviderEndpoint(selected);

    logger.debug("[EndpointResolver] Selected endpoint", {
      vendorId,
      providerType,
      endpointId: selected.id,
      baseUrl: selected.baseUrl,
      priority: selected.priority,
      weight: selected.weight,
      candidateCount: topPriority.length,
    });

    return selected.baseUrl;
  }
}
