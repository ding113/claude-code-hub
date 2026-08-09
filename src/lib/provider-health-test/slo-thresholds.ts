import { resolveHealthTestAvgLatencyMs } from "@/lib/provider-health-test/stats";

/** Runtime SLO thresholds shared by dispatch, rebalance, and health-test UI. */
export interface HealthTestSloThresholds {
  /** Minimum successful probe ratio, represented as 0..1. */
  minOnlineRate: number;
  /** Maximum average successful probe total wall time in milliseconds. */
  maxAvgLatencyMs: number;
  /** @deprecated Compatibility input alias; SLOs use total latency, not TTFB. */
  maxAvgFirstByteMs?: number;
  /** Minimum number of recent probe samples required for qualification. */
  minSampleCount: number;
}

export const DEFAULT_HEALTH_TEST_SLO_THRESHOLDS: HealthTestSloThresholds = {
  minOnlineRate: 0.9,
  maxAvgLatencyMs: 20_000,
  minSampleCount: 1,
};

export function normalizeHealthTestSloThresholds(
  thresholds?: Partial<HealthTestSloThresholds> | null
): HealthTestSloThresholds {
  const minOnlineRate = Number(thresholds?.minOnlineRate);
  const maxAvgLatencyMs = Number(
    thresholds?.maxAvgLatencyMs ?? thresholds?.maxAvgFirstByteMs
  );
  const minSampleCount = Number(thresholds?.minSampleCount);
  return {
    minOnlineRate: Number.isFinite(minOnlineRate)
      ? Math.min(1, Math.max(0, minOnlineRate))
      : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minOnlineRate,
    maxAvgLatencyMs:
      Number.isFinite(maxAvgLatencyMs) && maxAvgLatencyMs >= 0
        ? maxAvgLatencyMs
        : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgLatencyMs,
    minSampleCount:
      Number.isFinite(minSampleCount) && minSampleCount >= 1
        ? Math.min(50, Math.max(1, Math.trunc(minSampleCount)))
        : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minSampleCount,
  };
}

export function hasHealthTestSloMetrics(provider: {
  healthTestOnlineRate?: number | null;
  healthTestRecentResults?: unknown;
}): boolean {
  return (
    provider.healthTestOnlineRate != null &&
    Number.isFinite(provider.healthTestOnlineRate) &&
    resolveHealthTestAvgLatencyMs(provider) != null
  );
}

export function meetsHealthTestSloMetrics(
  provider: {
    healthTestOnlineRate?: number | null;
    healthTestRecentResults?: unknown;
  },
  thresholds?: Partial<HealthTestSloThresholds> | null
): boolean {
  if (!hasHealthTestSloMetrics(provider)) return false;
  const normalized = normalizeHealthTestSloThresholds(thresholds);
  const avgLatencyMs = resolveHealthTestAvgLatencyMs(provider);
  return (
    (provider.healthTestOnlineRate as number) >= normalized.minOnlineRate &&
    (avgLatencyMs as number) <= normalized.maxAvgLatencyMs
  );
}
