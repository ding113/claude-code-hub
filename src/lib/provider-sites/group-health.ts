import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
  hasHealthTestSloMetrics,
  meetsHealthTestSloMetrics,
  normalizeHealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import type { ProviderDisplay } from "@/types/provider";

export type ProviderSiteGroupHealthState = "ok" | "failed" | "pending" | "disabled";

export function projectProviderHealthForModel(
  provider: ProviderDisplay,
  model: string | null | undefined
): ProviderDisplay {
  const statsModel = model?.trim();
  if (!statsModel) return provider;

  const stats = provider.healthTestModelStats?.[statsModel];
  const recentResults = stats?.recentResults ?? [];
  const lastSample = recentResults.at(-1) ?? null;
  return {
    ...provider,
    healthTestOnlineRate: stats?.onlineRate ?? null,
    healthTestAvgFirstByteMs: stats?.avgFirstByteMs ?? null,
    healthTestRecentResults: recentResults,
    lastHealthTestModel: statsModel,
    lastHealthTestOk: lastSample?.ok ?? null,
    lastHealthTestStatus: lastSample?.status ?? null,
    lastHealthTestFirstByteMs: lastSample?.firstByteMs ?? null,
    lastHealthTestLatencyMs: lastSample?.latencyMs ?? null,
    lastHealthTestErrorType: lastSample?.errorType ?? null,
    lastHealthTestErrorMessage: lastSample?.errorMessage ?? null,
  };
}

function hasRecentHealthSample(provider: ProviderDisplay, minSampleCount: number): boolean {
  return (
    Array.isArray(provider.healthTestRecentResults) &&
    provider.healthTestRecentResults.length >= minSampleCount
  );
}

/**
 * A group is dispatch-ready when at least one linked, scheduled key has a
 * recent sample and passes both configured health SLO gates. A failed key does
 * not make the whole group unavailable when another key is healthy.
 */
export function resolveProviderSiteGroupHealthState(
  members: ProviderDisplay[],
  thresholds: Partial<HealthTestSloThresholds> = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  minSampleCount?: number,
  fallbackModel?: string | null
): ProviderSiteGroupHealthState {
  if (members.length === 0) return "pending";

  const normalizedThresholds = normalizeHealthTestSloThresholds(thresholds);

  const scheduledMembers = members
    .map((provider) => projectProviderHealthForModel(provider, fallbackModel))
    .filter(
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
