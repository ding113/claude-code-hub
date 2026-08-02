/** Runtime SLO thresholds shared by dispatch, rebalance, and health-test UI. */
export interface HealthTestSloThresholds {
  /** Minimum successful probe ratio, represented as 0..1. */
  minOnlineRate: number;
  /** Maximum average first-byte latency in milliseconds. */
  maxAvgFirstByteMs: number;
  /** Minimum number of recent probe samples required for qualification. */
  minSampleCount: number;
}

export const DEFAULT_HEALTH_TEST_SLO_THRESHOLDS: HealthTestSloThresholds = {
  minOnlineRate: 0.9,
  maxAvgFirstByteMs: 20_000,
  minSampleCount: 10,
};

export function normalizeHealthTestSloThresholds(
  thresholds?: Partial<HealthTestSloThresholds> | null
): HealthTestSloThresholds {
  const minOnlineRate = Number(thresholds?.minOnlineRate);
  const maxAvgFirstByteMs = Number(thresholds?.maxAvgFirstByteMs);
  const minSampleCount = Number(thresholds?.minSampleCount);
  return {
    minOnlineRate: Number.isFinite(minOnlineRate)
      ? Math.min(1, Math.max(0, minOnlineRate))
      : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minOnlineRate,
    maxAvgFirstByteMs:
      Number.isFinite(maxAvgFirstByteMs) && maxAvgFirstByteMs >= 0
        ? maxAvgFirstByteMs
        : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgFirstByteMs,
    minSampleCount:
      Number.isFinite(minSampleCount) && minSampleCount >= 1
        ? Math.min(50, Math.max(1, Math.trunc(minSampleCount)))
        : DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.minSampleCount,
  };
}

export function hasHealthTestSloMetrics(provider: {
  healthTestOnlineRate?: number | null;
  healthTestAvgFirstByteMs?: number | null;
}): boolean {
  return (
    provider.healthTestOnlineRate != null &&
    Number.isFinite(provider.healthTestOnlineRate) &&
    provider.healthTestAvgFirstByteMs != null &&
    Number.isFinite(provider.healthTestAvgFirstByteMs)
  );
}

export function meetsHealthTestSloMetrics(
  provider: {
    healthTestOnlineRate?: number | null;
    healthTestAvgFirstByteMs?: number | null;
  },
  thresholds?: Partial<HealthTestSloThresholds> | null
): boolean {
  if (!hasHealthTestSloMetrics(provider)) return false;
  const normalized = normalizeHealthTestSloThresholds(thresholds);
  return (
    (provider.healthTestOnlineRate as number) >= normalized.minOnlineRate &&
    (provider.healthTestAvgFirstByteMs as number) <= normalized.maxAvgFirstByteMs
  );
}
