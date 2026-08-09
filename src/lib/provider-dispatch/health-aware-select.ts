import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
  normalizeHealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import { resolveHealthTestAvgLatencyMs } from "@/lib/provider-health-test/stats";
import type { Provider } from "@/types/provider";

/** Online-rate floor for health-preferred dispatch (inclusive). */
export const HEALTH_DISPATCH_MIN_ONLINE_RATE = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minOnlineRate;

/** Average total wall-time ceiling for health-preferred dispatch (inclusive, ms). */
export const HEALTH_DISPATCH_MAX_AVG_LATENCY_MS =
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgLatencyMs;

/** @deprecated Compatibility alias. Dispatch SLOs use total wall time. */
export const HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS = HEALTH_DISPATCH_MAX_AVG_LATENCY_MS;

/**
 * Minimum recent probe samples before metrics can qualify for SLO. The rolling
 * window only caps averages and sparklines; it is not a qualification gate.
 */
export const HEALTH_DISPATCH_MIN_SAMPLE_COUNT = 1;

export type HealthDispatchMode = "health_slo" | "latency_fallback" | "legacy_cost";

export interface HealthDispatchCandidate {
  provider: Provider;
  onlineRate: number;
  /** Average successful total wall time used for SLO/ranking. */
  avgLatencyMs: number;
  /** @deprecated Compatibility log/UI alias; equals avgLatencyMs. */
  avgFirstByteMs: number;
  /** Effective dispatch cost (lower is better). */
  costMultiplier: number;
  /** @deprecated Kept for log/UI shape compatibility; equals costMultiplier. */
  priority: number;
}

/** Count samples in the denormalized recent window (post-clear = 0). */
export function getHealthTestSampleCount(provider: { healthTestRecentResults?: unknown }): number {
  const raw = provider.healthTestRecentResults;
  if (!Array.isArray(raw)) return 0;
  return raw.length;
}

/**
 * Resolve the cost used for dispatch ranking.
 * Prefer provider.costMultiplier (kept in sync with site group ratio for
 * site-linked providers). Non-finite / missing values fall back to 1.
 */
export function resolveDispatchCost(
  provider: Provider,
  resolveCost?: (provider: Provider) => number
): number {
  if (resolveCost) {
    const custom = resolveCost(provider);
    if (typeof custom === "number" && Number.isFinite(custom) && custom >= 0) {
      return custom;
    }
  }
  const raw = Number(provider.costMultiplier);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 1;
}

/**
 * A provider qualifies for health-preferred dispatch when:
 * - provider is enabled (isEnabled)
 * - scheduled health tests are still active (not budget-paused / manually off)
 * - at least the configured sample count (default 1) is present
 * - online rate and average successful total wall time meet the SLO
 *
 * Disabled / budget-paused providers must NOT be treated as "meets SLO".
 */
export function meetsHealthDispatchSlo(
  provider: Provider,
  thresholds?: Partial<HealthTestSloThresholds> | null
): boolean {
  // Must be enabled — the configured SLO alone is not enough.
  if (provider.isEnabled === false) return false;

  // Paused scheduled probes → exclude from health SLO candidate set.
  if (provider.scheduledHealthTestEnabled === false) return false;
  if (provider.healthTestSloAutoDisabled === true) return false;
  if (provider.healthTestBudgetSuspendedDay) return false;

  const normalizedThresholds = normalizeHealthTestSloThresholds(thresholds);
  if (getHealthTestSampleCount(provider) < normalizedThresholds.minSampleCount) {
    return false;
  }

  const onlineRate = provider.healthTestOnlineRate;
  const avgLatencyMs = resolveHealthTestAvgLatencyMs(provider);
  if (onlineRate == null || !Number.isFinite(onlineRate)) return false;
  if (avgLatencyMs == null || !Number.isFinite(avgLatencyMs)) return false;
  return (
    onlineRate >= normalizedThresholds.minOnlineRate &&
    avgLatencyMs <= normalizedThresholds.maxAvgLatencyMs
  );
}

/**
 * Among SLO-qualified providers, pick:
 * 1) lowest cost multiplier (cheaper first)
 * 2) then lowest average total wall time
 * 3) then stable id as tie-breaker
 *
 * Returns null when nobody meets the SLO — caller falls back to cheapest cost.
 * Callers should already pass enabled providers; isEnabled is still enforced here.
 *
 * `resolveCost` is optional; default uses provider.costMultiplier.
 * The second arg used to be resolvePriority; callers that still pass a priority
 * resolver are accepted but ignored for ranking (cost wins).
 */
export function selectBestHealthDispatchProvider(
  providers: Provider[],
  resolveCostOrLegacyPriority?: (provider: Provider) => number,
  thresholds?: Partial<HealthTestSloThresholds> | null
): { provider: Provider; mode: "health_slo"; candidates: HealthDispatchCandidate[] } | null {
  const candidates = listHealthDispatchCandidates(
    providers,
    resolveCostOrLegacyPriority,
    thresholds
  );
  if (candidates.length === 0) {
    return null;
  }

  return {
    provider: candidates[0].provider,
    mode: "health_slo",
    candidates,
  };
}

/**
 * Rank all SLO-qualified providers (same order as selectBestHealthDispatchProvider).
 * Used by first-byte hedge to pick the next alternate without re-introducing non-SLO peers.
 */
export function listHealthDispatchCandidates(
  providers: Provider[],
  resolveCost?: (provider: Provider) => number,
  thresholds?: Partial<HealthTestSloThresholds> | null
): HealthDispatchCandidate[] {
  const candidates: HealthDispatchCandidate[] = [];

  for (const provider of providers) {
    if (provider.isEnabled === false) continue;
    if (!meetsHealthDispatchSlo(provider, thresholds)) continue;
    const costMultiplier = resolveDispatchCost(provider, resolveCost);
    const avgLatencyMs = resolveHealthTestAvgLatencyMs(provider);
    if (avgLatencyMs == null) continue;
    candidates.push({
      provider,
      onlineRate: provider.healthTestOnlineRate as number,
      avgLatencyMs,
      avgFirstByteMs: avgLatencyMs,
      costMultiplier,
      // Log field reuse: selectedPriority / priorityLevels now mirror cost.
      priority: costMultiplier,
    });
  }

  candidates.sort((a, b) => {
    if (a.costMultiplier !== b.costMultiplier) return a.costMultiplier - b.costMultiplier;
    if (a.avgLatencyMs !== b.avgLatencyMs) return a.avgLatencyMs - b.avgLatencyMs;
    return a.provider.id - b.provider.id;
  });

  return candidates;
}

/**
 * Next health-SLO alternate after excluding already-launched provider ids.
 * Returns null when fewer than 1 remaining qualified peer exists (no race).
 */
export function selectNextHealthDispatchAlternate(
  providers: Provider[],
  resolveCostOrLegacyPriority: (provider: Provider) => number,
  excludeProviderIds: Iterable<number>,
  thresholds?: Partial<HealthTestSloThresholds> | null
): Provider | null {
  const excluded = new Set(excludeProviderIds);
  const remaining = listHealthDispatchCandidates(
    providers,
    resolveCostOrLegacyPriority,
    thresholds
  ).filter((c) => !excluded.has(c.provider.id));
  return remaining[0]?.provider ?? null;
}

/**
 * Deterministic average-latency pick among any enabled candidates (no SLO gate).
 * Used as the fallback when nobody meets health SLO.
 * Providers without a usable latency average sort after measured providers;
 * when latency is unavailable for every provider, cost then id remain stable
 * tie-breakers.
 */
export function selectFastestProvider(
  providers: Provider[],
  resolveCost?: (provider: Provider) => number
): Provider | null {
  const enabled = providers.filter((p) => p.isEnabled !== false);
  if (enabled.length === 0) return null;
  const ranked = [...enabled].sort((a, b) => {
    const latencyA = resolveHealthTestAvgLatencyMs(a);
    const latencyB = resolveHealthTestAvgLatencyMs(b);
    const hasLatencyA = latencyA != null && Number.isFinite(latencyA);
    const hasLatencyB = latencyB != null && Number.isFinite(latencyB);
    if (hasLatencyA !== hasLatencyB) return hasLatencyA ? -1 : 1;
    if (hasLatencyA && hasLatencyB && latencyA !== latencyB) {
      return (latencyA as number) - (latencyB as number);
    }

    const ca = resolveDispatchCost(a, resolveCost);
    const cb = resolveDispatchCost(b, resolveCost);
    if (ca !== cb) return ca - cb;
    return a.id - b.id;
  });
  return ranked[0] ?? null;
}

/**
 * Deterministic cheapest pick among any enabled candidates (no SLO gate).
 * Kept for non-proxy preference displays that still intentionally use cost.
 * Same cost → lower id wins (no weight random).
 */
export function selectCheapestProvider(
  providers: Provider[],
  resolveCost?: (provider: Provider) => number
): Provider | null {
  const enabled = providers.filter((p) => p.isEnabled !== false);
  if (enabled.length === 0) return null;
  const ranked = [...enabled].sort((a, b) => {
    const ca = resolveDispatchCost(a, resolveCost);
    const cb = resolveDispatchCost(b, resolveCost);
    if (ca !== cb) return ca - cb;
    return a.id - b.id;
  });
  return ranked[0] ?? null;
}
