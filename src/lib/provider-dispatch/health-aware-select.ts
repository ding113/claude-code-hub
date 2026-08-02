import { HEALTH_TEST_WINDOW_SIZE } from "@/lib/provider-health-test/defaults";
import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
  normalizeHealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import type { Provider } from "@/types/provider";

/** Online-rate floor for health-preferred dispatch (inclusive). */
export const HEALTH_DISPATCH_MIN_ONLINE_RATE = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minOnlineRate;

/** Average first-byte ceiling for health-preferred dispatch (inclusive, ms). */
export const HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS =
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgFirstByteMs;

/**
 * Minimum recent probe samples before metrics can qualify for SLO.
 * Matches the rolling window size so a freshly re-opened (cleared) provider
 * cannot become top1/top2 after 1–2 lucky successes.
 */
export const HEALTH_DISPATCH_MIN_SAMPLE_COUNT = HEALTH_TEST_WINDOW_SIZE;

export type HealthDispatchMode = "health_slo" | "legacy_cost";

export interface HealthDispatchCandidate {
  provider: Provider;
  onlineRate: number;
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
 * - recent window has the configured full sample set (default 10)
 * - both metrics exist and meet the configured online-rate / average first-byte SLO
 *
 * Disabled / budget-paused / short-window providers must NOT be treated as
 * "meets SLO" (clear-on-disable wipes history, so re-open must re-accumulate).
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
  // Full configured window required — avoids 1/1=100% false champions after rebalance re-open.
  if (getHealthTestSampleCount(provider) < normalizedThresholds.minSampleCount) {
    return false;
  }

  const onlineRate = provider.healthTestOnlineRate;
  const avgFirstByteMs = provider.healthTestAvgFirstByteMs;
  if (onlineRate == null || !Number.isFinite(onlineRate)) return false;
  if (avgFirstByteMs == null || !Number.isFinite(avgFirstByteMs)) return false;
  return (
    onlineRate >= normalizedThresholds.minOnlineRate &&
    avgFirstByteMs <= normalizedThresholds.maxAvgFirstByteMs
  );
}

/**
 * Among SLO-qualified providers, pick:
 * 1) lowest cost multiplier (cheaper first)
 * 2) then lowest average first-byte latency
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
    candidates.push({
      provider,
      onlineRate: provider.healthTestOnlineRate as number,
      avgFirstByteMs: provider.healthTestAvgFirstByteMs as number,
      costMultiplier,
      // Log field reuse: selectedPriority / priorityLevels now mirror cost.
      priority: costMultiplier,
    });
  }

  candidates.sort((a, b) => {
    if (a.costMultiplier !== b.costMultiplier) return a.costMultiplier - b.costMultiplier;
    if (a.avgFirstByteMs !== b.avgFirstByteMs) return a.avgFirstByteMs - b.avgFirstByteMs;
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
 * Deterministic cheapest pick among any enabled candidates (no SLO gate).
 * Used as the only fallback when nobody meets health SLO.
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
