import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { getAllEndpointHealthStatusAsync } from "@/lib/endpoint-circuit-breaker";
import {
  findEnabledProviderEndpointsByVendorAndType,
  findProviderEndpointsByVendorAndType,
} from "@/repository";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";

export function rankProviderEndpoints(endpoints: ProviderEndpoint[]): ProviderEndpoint[] {
  const enabled = endpoints.filter((e) => e.isEnabled && !e.deletedAt);

  const priorityRank = (endpoint: ProviderEndpoint): number => {
    if (endpoint.lastProbeOk === true) return 0;
    if (endpoint.lastProbeOk === null) return 1;
    return 2;
  };

  return enabled.slice().sort((a, b) => {
    const rankDiff = priorityRank(a) - priorityRank(b);
    if (rankDiff !== 0) return rankDiff;

    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;

    const aLatency = a.lastProbeLatencyMs ?? Number.POSITIVE_INFINITY;
    const bLatency = b.lastProbeLatencyMs ?? Number.POSITIVE_INFINITY;
    if (aLatency !== bLatency) return aLatency - bLatency;

    return a.id - b.id;
  });
}

export async function getPreferredProviderEndpoints(input: {
  vendorId: number;
  providerType: ProviderType;
  excludeEndpointIds?: number[];
}): Promise<ProviderEndpoint[]> {
  const excludeSet = new Set(input.excludeEndpointIds ?? []);

  const endpoints = await findEnabledProviderEndpointsByVendorAndType(
    input.vendorId,
    input.providerType
  );
  const filtered = endpoints.filter((e) => !excludeSet.has(e.id));
  const circuitCandidates = filtered.filter((e) => e.isEnabled && !e.deletedAt);

  if (circuitCandidates.length === 0) {
    return [];
  }

  // When endpoint circuit breaker is disabled, skip circuit check entirely
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return rankProviderEndpoints(circuitCandidates);
  }

  const healthStatus = await getAllEndpointHealthStatusAsync(circuitCandidates.map((e) => e.id));
  const candidates = circuitCandidates.filter(
    (endpoint) => healthStatus[endpoint.id]?.circuitState !== "open"
  );

  return rankProviderEndpoints(candidates);
}

export interface EndpointFilterStats {
  total: number;
  enabled: number;
  circuitOpen: number;
  available: number;
}

/**
 * Collect endpoint filter statistics for a given vendor/type.
 *
 * Used for audit trail when all endpoints are exhausted (strict block).
 * Returns null only when the raw endpoint query itself fails.
 */
export async function getEndpointFilterStats(input: {
  vendorId: number;
  providerType: ProviderType;
}): Promise<EndpointFilterStats> {
  const endpoints = await findProviderEndpointsByVendorAndType(input.vendorId, input.providerType);
  const total = endpoints.length;
  const enabledEndpoints = endpoints.filter((e) => e.isEnabled && !e.deletedAt);
  const enabled = enabledEndpoints.length;

  // When endpoint circuit breaker is disabled, no endpoints can be circuit-open
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return { total, enabled, circuitOpen: 0, available: enabled };
  }

  if (enabledEndpoints.length === 0) {
    return { total, enabled: 0, circuitOpen: 0, available: 0 };
  }

  const healthStatus = await getAllEndpointHealthStatusAsync(enabledEndpoints.map((e) => e.id));
  const circuitOpen = enabledEndpoints.filter(
    (e) => healthStatus[e.id]?.circuitState === "open"
  ).length;
  const available = enabled - circuitOpen;

  return { total, enabled, circuitOpen, available };
}

export async function pickBestProviderEndpoint(input: {
  vendorId: number;
  providerType: ProviderType;
  excludeEndpointIds?: number[];
}): Promise<ProviderEndpoint | null> {
  const ordered = await getPreferredProviderEndpoints(input);
  return ordered[0] ?? null;
}
