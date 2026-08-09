import { getHealthTestSampleCount } from "@/lib/provider-dispatch/health-aware-select";
import type { HealthTestSloThresholds } from "@/lib/provider-health-test/slo-thresholds";
import { normalizeHealthTestSloThresholds } from "@/lib/provider-health-test/slo-thresholds";
import { resolveHealthTestAvgLatencyMs } from "@/lib/provider-health-test/stats";
import type { ProviderType } from "@/types/provider";

/** How many SLO-qualified providers to keep probing per type pool (primary + backup). */
export const HEALTH_TEST_SLO_KEEP_COUNT = 2;

export type HealthRebalancePool = "claude" | "codex" | "openai-compatible" | "gemini" | "other";

export interface HealthRebalanceProvider {
  id: number;
  name?: string;
  providerType: ProviderType | string | null | undefined;
  isEnabled: boolean;
  /** Lower number = higher dispatch priority. */
  priority: number;
  scheduledHealthTestEnabled: boolean;
  /** Budget day key when suspended; null if not budget-paused. */
  healthTestBudgetSuspendedDay?: string | null;
  /** Owned by rebalance — may be re-enabled when exploring again. */
  healthTestSloAutoDisabled: boolean;
  healthTestOnlineRate: number | null;
  /** Legacy/display-only TTFB aggregate; SLO uses recent total latency instead. */
  healthTestAvgFirstByteMs?: number | null;
  /** Recent rolling samples (oldest→newest); one sample is enough to qualify. */
  healthTestRecentResults?: unknown;
}

export interface HealthRebalanceDecision {
  providerId: number;
  /** Desired scheduled_health_test_enabled after rebalance. */
  scheduledHealthTestEnabled: boolean;
  /** Desired health_test_slo_auto_disabled after rebalance. */
  healthTestSloAutoDisabled: boolean;
  reason:
    | "keep_champion"
    | "keep_backup"
    | "keep_above_top1"
    | "explore_all_on"
    | "disable_below_top1"
    | "skip_budget"
    | "skip_manual_off"
    | "skip_disabled"
    | "unchanged";
}

export interface HealthRebalancePoolResult {
  pool: HealthRebalancePool;
  mode: "explore_all" | "keep_top";
  keepIds: number[];
  decisions: HealthRebalanceDecision[];
}

/** Map concrete provider types into isolated rebalance pools. */
export function getHealthRebalancePool(
  providerType: ProviderType | string | null | undefined
): HealthRebalancePool {
  switch (providerType) {
    case "claude":
    case "claude-auth":
      return "claude";
    case "codex":
      return "codex";
    case "openai-compatible":
      return "openai-compatible";
    case "gemini":
    case "gemini-cli":
      return "gemini";
    default:
      return "other";
  }
}

/**
 * Metrics SLO for rebalance champions:
 * - at least the configured minimum sample count (default 1)
 * - onlineRate meets the configured minimum
 * - average successful total wall time meets the configured ceiling
 * Does NOT require scheduled tests to be on (caller still requires isEnabled).
 */
export function meetsHealthMetricsSlo(
  provider: {
    healthTestOnlineRate: number | null | undefined;
    healthTestAvgFirstByteMs?: number | null;
    healthTestRecentResults?: unknown;
  },
  thresholds?: Partial<HealthTestSloThresholds> | null
): boolean {
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

function sortChampions(a: HealthRebalanceProvider, b: HealthRebalanceProvider): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const af = resolveHealthTestAvgLatencyMs(a) ?? Number.POSITIVE_INFINITY;
  const bf = resolveHealthTestAvgLatencyMs(b) ?? Number.POSITIVE_INFINITY;
  if (af !== bf) return af - bf;
  return a.id - b.id;
}

function pushKeep(
  decisions: HealthRebalanceDecision[],
  p: HealthRebalanceProvider,
  reason: HealthRebalanceDecision["reason"]
): void {
  if (!p.scheduledHealthTestEnabled || p.healthTestSloAutoDisabled) {
    decisions.push({
      providerId: p.id,
      scheduledHealthTestEnabled: true,
      healthTestSloAutoDisabled: false,
      reason,
    });
  } else {
    decisions.push({
      providerId: p.id,
      scheduledHealthTestEnabled: true,
      healthTestSloAutoDisabled: false,
      reason: "unchanged",
    });
  }
}

function pushDisable(
  decisions: HealthRebalanceDecision[],
  p: HealthRebalanceProvider,
  reason: HealthRebalanceDecision["reason"]
): void {
  if (p.scheduledHealthTestEnabled || !p.healthTestSloAutoDisabled) {
    decisions.push({
      providerId: p.id,
      scheduledHealthTestEnabled: false,
      healthTestSloAutoDisabled: true,
      reason,
    });
  } else {
    decisions.push({
      providerId: p.id,
      scheduledHealthTestEnabled: false,
      healthTestSloAutoDisabled: true,
      reason: "unchanged",
    });
  }
}

/**
 * Pure rebalance for one type pool.
 *
 * When ≥2 SLO-qualified champions exist (enabled + configured SLO):
 *   top1 / top2 = sort by priority ASC, then avg total latency ASC, then id
 *   KEEP above top1 priority + top1 + top2; DISABLE everything else below top1.
 *
 * When <2 qualify → explore: re-open auto-disabled among enabled providers.
 * Never force-on: budget suspended or manual off. Disabled providers never top1/top2.
 * SLO = minimum samples + configured online rate + configured avg total-latency ceiling.
 */
export function planHealthTestSloRebalanceForPool(
  providers: HealthRebalanceProvider[],
  keepCount: number = HEALTH_TEST_SLO_KEEP_COUNT,
  thresholds?: Partial<HealthTestSloThresholds> | null
): Omit<HealthRebalancePoolResult, "pool"> {
  const decisions: HealthRebalanceDecision[] = [];
  const k = Math.max(1, keepCount);

  const active = providers.filter((p) => p.isEnabled === true);
  const qualified = active.filter((p) => meetsHealthMetricsSlo(p, thresholds)).sort(sortChampions);

  if (qualified.length < k) {
    for (const p of active) {
      if (p.healthTestBudgetSuspendedDay) {
        decisions.push({
          providerId: p.id,
          scheduledHealthTestEnabled: p.scheduledHealthTestEnabled,
          healthTestSloAutoDisabled: p.healthTestSloAutoDisabled,
          reason: "skip_budget",
        });
        continue;
      }
      if (!p.scheduledHealthTestEnabled && !p.healthTestSloAutoDisabled) {
        decisions.push({
          providerId: p.id,
          scheduledHealthTestEnabled: false,
          healthTestSloAutoDisabled: false,
          reason: "skip_manual_off",
        });
        continue;
      }
      if (p.healthTestSloAutoDisabled || !p.scheduledHealthTestEnabled) {
        decisions.push({
          providerId: p.id,
          scheduledHealthTestEnabled: true,
          healthTestSloAutoDisabled: false,
          reason: "explore_all_on",
        });
      } else {
        decisions.push({
          providerId: p.id,
          scheduledHealthTestEnabled: true,
          healthTestSloAutoDisabled: false,
          reason: "unchanged",
        });
      }
    }
    for (const p of providers.filter((x) => !x.isEnabled)) {
      decisions.push({
        providerId: p.id,
        scheduledHealthTestEnabled: p.scheduledHealthTestEnabled,
        healthTestSloAutoDisabled: p.healthTestSloAutoDisabled,
        reason: "skip_disabled",
      });
    }
    return { mode: "explore_all", keepIds: qualified.map((q) => q.id), decisions };
  }

  const top1 = qualified[0]!;
  const top2 = qualified[1]!;

  for (const p of active) {
    if (p.healthTestBudgetSuspendedDay) {
      decisions.push({
        providerId: p.id,
        scheduledHealthTestEnabled: p.scheduledHealthTestEnabled,
        healthTestSloAutoDisabled: p.healthTestSloAutoDisabled,
        reason: "skip_budget",
      });
      continue;
    }

    if (!p.scheduledHealthTestEnabled && !p.healthTestSloAutoDisabled) {
      decisions.push({
        providerId: p.id,
        scheduledHealthTestEnabled: false,
        healthTestSloAutoDisabled: false,
        reason: "skip_manual_off",
      });
      continue;
    }

    if (p.priority < top1.priority) {
      pushKeep(decisions, p, "keep_above_top1");
      continue;
    }

    if (p.id === top1.id) {
      pushKeep(decisions, p, "keep_champion");
      continue;
    }
    if (p.id === top2.id) {
      pushKeep(decisions, p, "keep_backup");
      continue;
    }

    pushDisable(decisions, p, "disable_below_top1");
  }

  for (const p of providers.filter((x) => !x.isEnabled)) {
    decisions.push({
      providerId: p.id,
      scheduledHealthTestEnabled: p.scheduledHealthTestEnabled,
      healthTestSloAutoDisabled: p.healthTestSloAutoDisabled,
      reason: "skip_disabled",
    });
  }

  return { mode: "keep_top", keepIds: [top1.id, top2.id], decisions };
}

export function planHealthTestSloRebalanceAll(
  providers: HealthRebalanceProvider[],
  keepCount: number = HEALTH_TEST_SLO_KEEP_COUNT,
  thresholds?: Partial<HealthTestSloThresholds> | null
): HealthRebalancePoolResult[] {
  const byPool = new Map<HealthRebalancePool, HealthRebalanceProvider[]>();
  for (const p of providers) {
    const pool = getHealthRebalancePool(p.providerType);
    const list = byPool.get(pool) ?? [];
    list.push(p);
    byPool.set(pool, list);
  }

  const results: HealthRebalancePoolResult[] = [];
  for (const [pool, list] of byPool) {
    const planned = planHealthTestSloRebalanceForPool(list, keepCount, thresholds);
    results.push({ pool, ...planned });
  }
  return results;
}

/** Decisions that actually change DB fields. */
export function filterRebalanceChanges(
  providers: HealthRebalanceProvider[],
  decisions: HealthRebalanceDecision[]
): HealthRebalanceDecision[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  return decisions.filter((d) => {
    const p = byId.get(d.providerId);
    if (!p) return false;
    return (
      p.scheduledHealthTestEnabled !== d.scheduledHealthTestEnabled ||
      p.healthTestSloAutoDisabled !== d.healthTestSloAutoDisabled
    );
  });
}
