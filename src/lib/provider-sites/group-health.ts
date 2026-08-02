import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
  hasHealthTestSloMetrics,
  meetsHealthTestSloMetrics,
  normalizeHealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import type { ProviderDisplay } from "@/types/provider";

export type ProviderSiteGroupHealthState = "ok" | "failed" | "pending" | "disabled";

function hasRecentHealthSample(provider: ProviderDisplay, minSampleCount: number): boolean {
  return (
    Array.isArray(provider.healthTestRecentResults) &&
    provider.healthTestRecentResults.length >= minSampleCount
  );
}

/**
 * A group is dispatch-ready when at least one linked, scheduled key has a complete
 * recent window and passes both configured health SLO gates. A failed key does not
 * make the whole group unavailable when another key is healthy.
 */
export function resolveProviderSiteGroupHealthState(
  members: ProviderDisplay[],
  thresholds: Partial<HealthTestSloThresholds> = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  minSampleCount?: number
): ProviderSiteGroupHealthState {
  if (members.length === 0) return "pending";

  const normalizedThresholds = normalizeHealthTestSloThresholds(thresholds);

  const scheduledMembers = members.filter(
    (provider) =>
      provider.isEnabled !== false &&
      provider.scheduledHealthTestEnabled !== false &&
      provider.healthTestSloAutoDisabled !== true
  );
  if (scheduledMembers.length === 0) return "disabled";

  const requiredSampleCount = Math.min(
    50,
    Math.max(1, Math.trunc(minSampleCount ?? normalizedThresholds.minSampleCount) || 1)
  );
  const sampledMembers = scheduledMembers.filter((provider) =>
    hasRecentHealthSample(provider, requiredSampleCount)
  );
  if (
    sampledMembers.some((provider) => meetsHealthTestSloMetrics(provider, normalizedThresholds))
  ) {
    return "ok";
  }
  if (
    sampledMembers.some(
      (provider) => hasHealthTestSloMetrics(provider) || provider.lastHealthTestOk === false
    )
  ) {
    return "failed";
  }
  return "pending";
}
