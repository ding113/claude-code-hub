import {
  listHealthDispatchCandidates,
  resolveDispatchCost,
  selectBestHealthDispatchProvider,
  selectCheapestProvider,
} from "@/lib/provider-dispatch/health-aware-select";
import { resolveProviderHealthTestModelForRequest } from "@/lib/provider-health-test/model-config";
import { parseProviderGroups, resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import type { Provider } from "@/types/provider";

export type HealthSloThresholds = Parameters<typeof selectBestHealthDispatchProvider>[2];

export type GroupPreferredPickMode = "health_slo" | "legacy_priority";

export interface GroupPreferredProvider {
  group: string;
  providerId: number;
  providerName: string;
  /** Upstream request format / protocol (providers.provider_type). */
  providerType: string;
  /** providers.cost_multiplier of the preferred peer. */
  providerCostMultiplier: number;
  /** provider_groups.cost_multiplier for this group label (1 if unknown). */
  groupCostMultiplier: number;
  /**
   * Effective bill rate for this group path:
   * providerCostMultiplier * groupCostMultiplier
   * (matches calculateRequestCost).
   */
  costMultiplier: number;
  priority: number;
  mode: GroupPreferredPickMode;
  /** Model whose independent health result is used for this pick, if any. */
  healthTestModel: string | null;
  onlineRate: number | null;
  avgFirstByteMs: number | null;
  sampleCount: number;
}

function providerBelongsToGroup(provider: Provider, group: string): boolean {
  const tags = resolveProviderGroupsWithDefault(provider.groupTag);
  return tags.includes(group);
}

function resolvePriorityForGroup(provider: Provider, group: string): number {
  const override = provider.groupPriorities?.[group];
  if (override != null && Number.isFinite(override)) return override;
  return provider.priority ?? 0;
}

function projectProviderHealthForGroupModel(
  provider: Provider,
  group: string,
  requestedModel: string | undefined,
  healthTestModelsByGroup: ReadonlyMap<string, string[] | null | undefined> | undefined,
  healthTestModelFallbacksByGroup: ReadonlyMap<string, string | null | undefined> | undefined
): Provider {
  const model = resolveProviderHealthTestModelForRequest(
    group,
    requestedModel,
    healthTestModelsByGroup ?? new Map(),
    healthTestModelFallbacksByGroup
  );
  if (!model) return provider;

  const stats = provider.healthTestModelStats?.[model];
  const recentResults = stats?.recentResults ?? [];
  const lastSample = recentResults.at(-1) ?? null;
  return {
    ...provider,
    healthTestOnlineRate: stats?.onlineRate ?? null,
    healthTestAvgFirstByteMs: stats?.avgFirstByteMs ?? null,
    healthTestRecentResults: recentResults,
    lastHealthTestModel: model,
    lastHealthTestOk: lastSample?.ok ?? null,
    lastHealthTestStatus: lastSample?.status ?? null,
    lastHealthTestFirstByteMs: lastSample?.firstByteMs ?? null,
    lastHealthTestLatencyMs: lastSample?.latencyMs ?? null,
  };
}

function sanitizeMult(value: number | null | undefined, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function resolveGroupTableMultiplier(
  group: string,
  groupTableMultipliers?: Map<string, number> | Record<string, number> | null
): number {
  if (!groupTableMultipliers) return 1;
  if (groupTableMultipliers instanceof Map) {
    const v = groupTableMultipliers.get(group);
    return sanitizeMult(v, 1);
  }
  return sanitizeMult(groupTableMultipliers[group], 1);
}

function buildPick(
  group: string,
  provider: Provider,
  mode: GroupPreferredPickMode,
  extras: {
    healthTestModel: string | null;
    onlineRate: number | null;
    avgFirstByteMs: number | null;
    sampleCount: number;
    priority: number;
    groupTableMultipliers?: Map<string, number> | Record<string, number> | null;
  }
): GroupPreferredProvider {
  const providerCostMultiplier = sanitizeMult(Number(provider.costMultiplier ?? 1), 1);
  const groupCostMultiplier = resolveGroupTableMultiplier(group, extras.groupTableMultipliers);
  return {
    group,
    providerId: provider.id,
    providerName: provider.name,
    providerType: String(provider.providerType || "claude"),
    providerCostMultiplier,
    groupCostMultiplier,
    costMultiplier: providerCostMultiplier * groupCostMultiplier,
    priority: extras.priority,
    mode,
    healthTestModel: extras.healthTestModel,
    onlineRate: extras.onlineRate,
    avgFirstByteMs: extras.avgFirstByteMs,
    sampleCount: extras.sampleCount,
  };
}

/**
 * Pick the provider that would currently be preferred for traffic in `group`,
 * using the same health gate and ranking as request dispatch:
 * 1) health_slo tiers when anyone qualifies
 * 2) else lowest provider cost among enabled peers
 *
 * Only `isEnabled` providers are considered. Scheduled-off / incomplete windows
 * simply fall out of health_slo into legacy priority among enabled peers.
 *
 * `groupTableMultipliers` supplies provider_groups.cost_multiplier by group name.
 * `healthSloThresholds` must come from the live site runtime config for any
 * user-facing "current preferred" display.
 * Effective bill rate = preferred provider.cost_multiplier × group table mult.
 */
export function pickPreferredProviderForGroup(
  providers: Provider[],
  group: string,
  groupTableMultipliers?: Map<string, number> | Record<string, number> | null,
  healthSloThresholds?: HealthSloThresholds | null,
  requestedModel?: string,
  healthTestModelsByGroup?: ReadonlyMap<string, string[] | null | undefined>,
  healthTestModelFallbacksByGroup?: ReadonlyMap<string, string | null | undefined>
): GroupPreferredProvider | null {
  const g = (group || "").trim();
  if (!g) return null;

  const peers = providers.filter((p) => p.isEnabled !== false && providerBelongsToGroup(p, g));
  if (peers.length === 0) return null;

  const healthPeers = peers.map((provider) =>
    projectProviderHealthForGroupModel(
      provider,
      g,
      requestedModel,
      healthTestModelsByGroup,
      healthTestModelFallbacksByGroup
    )
  );
  const healthTestModel = resolveProviderHealthTestModelForRequest(
    g,
    requestedModel,
    healthTestModelsByGroup ?? new Map(),
    healthTestModelFallbacksByGroup
  );
  const resolvePriority = (p: Provider) => resolvePriorityForGroup(p, g);
  const slo = selectBestHealthDispatchProvider(
    healthPeers,
    resolveDispatchCost,
    healthSloThresholds
  );
  if (slo) {
    const cand = listHealthDispatchCandidates(
      healthPeers,
      resolveDispatchCost,
      healthSloThresholds
    )[0];
    return buildPick(g, slo.provider, "health_slo", {
      healthTestModel,
      priority: resolvePriority(slo.provider),
      onlineRate: cand?.onlineRate ?? slo.provider.healthTestOnlineRate ?? null,
      avgFirstByteMs: cand?.avgFirstByteMs ?? slo.provider.healthTestAvgFirstByteMs ?? null,
      sampleCount: Array.isArray(slo.provider.healthTestRecentResults)
        ? slo.provider.healthTestRecentResults.length
        : 0,
      groupTableMultipliers,
    });
  }

  const top = selectCheapestProvider(peers, resolveDispatchCost);
  if (!top) return null;
  const displayedTop = healthPeers.find((provider) => provider.id === top.id) ?? top;
  return buildPick(g, displayedTop, "legacy_priority", {
    healthTestModel,
    priority: resolvePriority(top),
    onlineRate: displayedTop.healthTestOnlineRate ?? null,
    avgFirstByteMs: displayedTop.healthTestAvgFirstByteMs ?? null,
    sampleCount: Array.isArray(displayedTop.healthTestRecentResults)
      ? displayedTop.healthTestRecentResults.length
      : 0,
    groupTableMultipliers,
  });
}

/**
 * For each group in `groups`, pick the current preferred provider multiplier.
 * Groups with no enabled provider are omitted (caller may show empty state).
 */
export function pickPreferredProvidersForGroups(
  providers: Provider[],
  groups: string[],
  groupTableMultipliers?: Map<string, number> | Record<string, number> | null,
  healthSloThresholds?: HealthSloThresholds | null,
  requestedModel?: string,
  healthTestModelsByGroup?: ReadonlyMap<string, string[] | null | undefined>,
  healthTestModelFallbacksByGroup?: ReadonlyMap<string, string | null | undefined>
): GroupPreferredProvider[] {
  const out: GroupPreferredProvider[] = [];
  const seen = new Set<string>();
  for (const raw of groups) {
    const g = (raw || "").trim();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    const pick = pickPreferredProviderForGroup(
      providers,
      g,
      groupTableMultipliers,
      healthSloThresholds,
      requestedModel,
      healthTestModelsByGroup,
      healthTestModelFallbacksByGroup
    );
    if (pick) out.push(pick);
  }
  // Stable display: cheaper effective rate first, then name
  out.sort((a, b) => {
    if (a.costMultiplier !== b.costMultiplier) return a.costMultiplier - b.costMultiplier;
    return a.group.localeCompare(b.group);
  });
  return out;
}

/** Expand key/user group CSV into tags; `*` means all managed labels from providers. */
export function expandUserVisibleGroups(
  keyOrUserGroup: string | null | undefined,
  providers: Provider[],
  managedFallback: string[] = ["claude", "codex", "grok", "image", "Kimi"]
): string[] {
  const raw = parseProviderGroups(keyOrUserGroup);
  if (raw.length === 0 || raw.includes("*")) {
    const tags = new Set<string>();
    for (const p of providers) {
      for (const t of resolveProviderGroupsWithDefault(p.groupTag)) {
        if (t && t !== "default") tags.add(t);
      }
    }
    // Prefer known managed order, then any extras
    const ordered: string[] = [];
    for (const m of managedFallback) {
      if (tags.has(m)) {
        ordered.push(m);
        tags.delete(m);
      }
    }
    return [...ordered, ...Array.from(tags).sort()];
  }
  return raw.filter((g) => g !== "default");
}
