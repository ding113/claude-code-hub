import { isCircuitOpen } from "@/lib/circuit-breaker";
import { RateLimitService } from "@/lib/rate-limit";
import type { Provider } from "@/types/provider";
import type { Vendor, VendorApiFormat, VendorEndpoint, VendorKey } from "@/types/vendor";
import { checkProviderGroupMatch } from "./provider-selector";

export interface VendorKeySelection {
  vendor: Vendor;
  endpoint: VendorEndpoint;
  key: VendorKey;
}

export interface VendorSelectorDeps {
  isCircuitOpen: (vendorKeyId: number) => Promise<boolean>;
  checkCostLimits: (
    vendorKeyId: number,
    vendorKey: VendorKey
  ) => Promise<{ allowed: boolean; reason?: string }>;
}

const defaultDeps: VendorSelectorDeps = {
  isCircuitOpen,
  checkCostLimits: (vendorKeyId, vendorKey) =>
    RateLimitService.checkCostLimits(vendorKeyId, "provider", {
      limit_5h_usd: vendorKey.limit5hUsd,
      limit_daily_usd: vendorKey.limitDailyUsd,
      daily_reset_mode: vendorKey.dailyResetMode,
      daily_reset_time: vendorKey.dailyResetTime,
      limit_weekly_usd: vendorKey.limitWeeklyUsd,
      limit_monthly_usd: vendorKey.limitMonthlyUsd,
    }),
};

function isEndpointHealthy(endpoint: VendorEndpoint): boolean {
  if (!endpoint.healthCheckEnabled) return true;

  // Fail open: never checked => treat as healthy
  if (!endpoint.healthCheckLastCheckedAt) return true;

  const status = endpoint.healthCheckLastStatusCode;
  if (status == null) return false;
  return status >= 200 && status < 300;
}

function compareLatency(a: number | null, b: number | null): number {
  // nulls last
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function selectTopPriority<T extends { priority: number }>(items: T[]): T[] {
  if (items.length === 0) return [];
  const minPriority = Math.min(...items.map((i) => i.priority));
  return items.filter((i) => i.priority === minPriority);
}

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  if (items.length === 0) {
    throw new Error("No candidates for weightedRandom");
  }

  if (items.length === 1) return items[0];

  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight <= 0) {
    const idx = Math.floor(Math.random() * items.length);
    return items[idx];
  }

  const r = Math.random() * totalWeight;
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.weight;
    if (r < cumulative) return item;
  }

  return items[items.length - 1];
}

function selectOptimalKey(keys: VendorKey[]): VendorKey {
  const topPriority = selectTopPriority(keys);
  if (topPriority.length === 0) {
    throw new Error("No keys available for selection");
  }

  // Match provider-selector behavior: sort by cost multiplier, then weighted random
  const sorted = [...topPriority].sort((a, b) => a.costMultiplier - b.costMultiplier);
  return weightedRandom(sorted);
}

function keyMatchesGroup(key: VendorKey, userGroup: string | null): boolean {
  if (!userGroup) return true;
  return checkProviderGroupMatch(key.groupTag, userGroup);
}

function providerTypeToApiFormat(providerType: Provider["providerType"]): VendorApiFormat {
  switch (providerType) {
    case "claude":
    case "claude-auth":
      return "claude";
    case "gemini":
    case "gemini-cli":
      return "gemini";
    default:
      return "codex";
  }
}

function endpointMatchesTarget(
  endpoint: VendorEndpoint,
  targetApiFormat: VendorApiFormat | null,
  keysInVendorEndpoint: VendorKey[]
): boolean {
  // If targetApiFormat is provided, prefer endpoint.apiFormat matching.
  // For backward compatibility (openai-compatible, gemini-cli), also allow endpoint.apiFormat
  // inferred from key.providerType when endpoint apiFormat is missing/mismatched.
  if (!targetApiFormat) return true;
  if (endpoint.apiFormat === targetApiFormat) return true;

  // Allow fallback based on keys, to support legacy provider types
  return keysInVendorEndpoint.some(
    (k) => providerTypeToApiFormat(k.providerType) === targetApiFormat
  );
}

/**
 * Vendor -> Endpoint -> Key selection.
 *
 * Design goals:
 * - Vendor layer: enabled status + group filtering (based on keys' groupTag)
 * - Endpoint layer: health + latency/priority sorting
 * - Key layer: circuit breaker + cost limits + (priority -> cost -> weighted random)
 */
export async function selectVendorKey(
  input: {
    vendors: Vendor[];
    endpoints: VendorEndpoint[];
    keys: VendorKey[];
    userGroup: string | null;
    targetApiFormat: VendorApiFormat | null;
  },
  deps: VendorSelectorDeps = defaultDeps
): Promise<VendorKeySelection | null> {
  const enabledVendors = input.vendors.filter((v) => v.isEnabled);

  // Vendor layer group filtering: keep vendors that have at least one key matching the group.
  const groupFilteredVendors = input.userGroup
    ? enabledVendors.filter((v) => {
        const vendorKeys = input.keys.filter((k) => k.vendorId === v.id);
        return vendorKeys.some((k) => keyMatchesGroup(k, input.userGroup));
      })
    : enabledVendors;

  for (const vendor of groupFilteredVendors) {
    const vendorEndpoints = input.endpoints.filter((e) => e.vendorId === vendor.id && e.isEnabled);

    const endpointsSorted = [...vendorEndpoints]
      .filter((e) => {
        const keysForEndpoint = input.keys.filter(
          (k) => k.vendorId === vendor.id && k.endpointId === e.id
        );
        return endpointMatchesTarget(e, input.targetApiFormat, keysForEndpoint);
      })
      .sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) return priorityDiff;
        const latencyDiff = compareLatency(a.latencyMs, b.latencyMs);
        if (latencyDiff !== 0) return latencyDiff;
        return a.id - b.id;
      });

    // Endpoint layer: try healthy endpoints first, but fail-open to all endpoints if needed.
    const healthyFirst: VendorEndpoint[] = [];
    const unhealthy: VendorEndpoint[] = [];
    for (const e of endpointsSorted) {
      if (isEndpointHealthy(e)) {
        healthyFirst.push(e);
      } else {
        unhealthy.push(e);
      }
    }

    // Prefer healthy endpoints, but still fall back to unhealthy ones if needed.
    const endpointCandidates = [...healthyFirst, ...unhealthy];

    for (const endpoint of endpointCandidates) {
      // Key layer: only keys under selected vendor+endpoint
      const keysUnderEndpoint = input.keys
        .filter((k) => k.vendorId === vendor.id && k.endpointId === endpoint.id)
        .filter((k) => k.isEnabled)
        .filter((k) => keyMatchesGroup(k, input.userGroup));

      if (keysUnderEndpoint.length === 0) continue;

      const checks = await Promise.all(
        keysUnderEndpoint.map(async (k) => {
          if (await deps.isCircuitOpen(k.id)) {
            return null;
          }
          const cost = await deps.checkCostLimits(k.id, k);
          if (!cost.allowed) {
            return null;
          }
          return k;
        })
      );

      const availableKeys = checks.filter((k): k is VendorKey => k !== null);
      if (availableKeys.length === 0) continue;

      const selectedKey = selectOptimalKey(availableKeys);
      return { vendor, endpoint, key: selectedKey };
    }
  }

  return null;
}
