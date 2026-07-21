import type { Provider } from "@/types/provider";
import { HEALTH_TEST_WINDOW_SIZE } from "@/lib/provider-health-test/defaults";

/** Online-rate floor for health-preferred dispatch (inclusive). */
export const HEALTH_DISPATCH_MIN_ONLINE_RATE = 0.8;

/** Average first-byte ceiling for health-preferred dispatch (inclusive, ms). */
export const HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS = 10_000;

/**
 * Minimum recent probe samples before metrics can qualify for SLO.
 * Matches the rolling window size so a freshly re-opened (cleared) provider
 * cannot become top1/top2 after 1–2 lucky successes.
 */
export const HEALTH_DISPATCH_MIN_SAMPLE_COUNT = HEALTH_TEST_WINDOW_SIZE;

export type HealthDispatchMode = "health_slo" | "legacy_priority_weight";

export interface HealthDispatchCandidate {
  provider: Provider;
  onlineRate: number;
  avgFirstByteMs: number;
  priority: number;
}

/** Count samples in the denormalized recent window (post-clear = 0). */
export function getHealthTestSampleCount(provider: {
  healthTestRecentResults?: unknown;
}): number {
  const raw = provider.healthTestRecentResults;
  if (!Array.isArray(raw)) return 0;
  return raw.length;
}

/**
 * A provider qualifies for health-preferred dispatch when:
 * - provider is enabled (isEnabled)
 * - scheduled health tests are still active (not budget-paused / manually off)
 * - recent window has a full sample set (default 10)
 * - both metrics exist and meet the 80% / 10s SLO
 *
 * Disabled / budget-paused / short-window providers must NOT be treated as
 * "meets SLO" (clear-on-disable wipes history, so re-open must re-accumulate).
 */
export function meetsHealthDispatchSlo(provider: Provider): boolean {
  // Must be enabled — 80%/10s alone is not enough.
  if (provider.isEnabled === false) return false;

  // Paused scheduled probes → exclude from health SLO candidate set.
  if (provider.scheduledHealthTestEnabled === false) return false;
  if (provider.healthTestBudgetSuspendedDay) return false;

  // Full window required — avoids 1/1=100% false champions after rebalance re-open.
  if (getHealthTestSampleCount(provider) < HEALTH_DISPATCH_MIN_SAMPLE_COUNT) {
    return false;
  }

  const onlineRate = provider.healthTestOnlineRate;
  const avgFirstByteMs = provider.healthTestAvgFirstByteMs;
  if (onlineRate == null || !Number.isFinite(onlineRate)) return false;
  if (avgFirstByteMs == null || !Number.isFinite(avgFirstByteMs)) return false;
  return (
    onlineRate >= HEALTH_DISPATCH_MIN_ONLINE_RATE &&
    avgFirstByteMs <= HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS
  );
}

/**
 * Among SLO-qualified providers, pick:
 * 1) best (lowest) priority
 * 2) then lowest average first-byte latency
 * 3) then stable id as tie-breaker
 *
 * Returns null when nobody meets the SLO — caller falls back to legacy priority+weight.
 * Callers should already pass enabled providers; isEnabled is still enforced here.
 */
export function selectBestHealthDispatchProvider(
  providers: Provider[],
  resolvePriority: (provider: Provider) => number
): { provider: Provider; mode: "health_slo"; candidates: HealthDispatchCandidate[] } | null {
  const candidates = listHealthDispatchCandidates(providers, resolvePriority);
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
  resolvePriority: (provider: Provider) => number
): HealthDispatchCandidate[] {
  const candidates: HealthDispatchCandidate[] = [];

  for (const provider of providers) {
    if (provider.isEnabled === false) continue;
    if (!meetsHealthDispatchSlo(provider)) continue;
    candidates.push({
      provider,
      onlineRate: provider.healthTestOnlineRate as number,
      avgFirstByteMs: provider.healthTestAvgFirstByteMs as number,
      priority: resolvePriority(provider),
    });
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
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
  resolvePriority: (provider: Provider) => number,
  excludeProviderIds: Iterable<number>
): Provider | null {
  const excluded = new Set(excludeProviderIds);
  const remaining = listHealthDispatchCandidates(providers, resolvePriority).filter(
    (c) => !excluded.has(c.provider.id)
  );
  return remaining[0]?.provider ?? null;
}
