import "server-only";

import { isEndpointCircuitOpen } from "@/lib/endpoint-circuit-breaker";
import { findProviderEndpointsByVendorAndType } from "@/repository";
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

  const endpoints = await findProviderEndpointsByVendorAndType(input.vendorId, input.providerType);
  const filtered = endpoints.filter((e) => e.isEnabled && !e.deletedAt && !excludeSet.has(e.id));

  if (filtered.length === 0) {
    return [];
  }

  const circuitResults = await Promise.all(
    filtered.map(async (endpoint) => ({
      endpoint,
      isOpen: await isEndpointCircuitOpen(endpoint.id),
    }))
  );

  const candidates = circuitResults.filter(({ isOpen }) => !isOpen).map(({ endpoint }) => endpoint);

  return rankProviderEndpoints(candidates);
}

export async function pickBestProviderEndpoint(input: {
  vendorId: number;
  providerType: ProviderType;
  excludeEndpointIds?: number[];
}): Promise<ProviderEndpoint | null> {
  const ordered = await getPreferredProviderEndpoints(input);
  return ordered[0] ?? null;
}
