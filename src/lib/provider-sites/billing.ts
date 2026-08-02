/**
 * Upstream-site group rate helpers.
 *
 * Upstream Hub stores one ratio per website group (Claude Kiro / codex-Plus / ...).
 * CCH historically flattened that into providers.cost_multiplier and billed:
 *   tokens × catalog model_prices × provider.cost_multiplier × group.cost_multiplier
 *
 * Site-group billing keeps the website group ratio as the primary multiplier and
 * still uses CCH model_prices as the unit catalogue until true per-request upstream
 * settlement is available.
 */

import {
  classifySiteGroupTagWithGroups,
  type ClassifiableProviderGroup,
} from "@/lib/provider-groups/match-rules";

export type ProviderBillingMode = "catalog_estimate" | "site_group_ratio";

export type SiteGroupRateLike = {
  groupName: string;
  ratio: number | string;
  completionRatio?: number | string | null;
  dispatchGroupTag?: string | null;
  description?: string | null;
};

export type ResolvedSiteBillingMultipliers = {
  mode: ProviderBillingMode;
  /** Multiplier applied to the catalogue token total (or input portion). */
  multiplier: number;
  /**
   * Optional output multiplier relative to catalogue output price.
   * Null means keep using multiplier for all token classes.
   */
  outputMultiplier: number | null;
  groupName: string | null;
  source: "site_group_rate" | "provider_cost_multiplier" | "fallback";
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Classify an upstream website group into CCH dispatch pools.
 * Driven only by provider_groups.match_rules + sort_order (no hard-coded keywords).
 * Missing groups / no match → "other".
 */
export function classifySiteGroupTag(
  groupName: string,
  groups?: ClassifiableProviderGroup[] | null
): string {
  return classifySiteGroupTagWithGroups(groupName, groups);
}

export { classifySiteGroupTagWithGroups };

export function findSiteGroupRate(
  rates: SiteGroupRateLike[] | null | undefined,
  groupName: string | null | undefined
): SiteGroupRateLike | null {
  if (!rates?.length || !groupName) return null;
  const wanted = groupName.trim().toLowerCase();
  if (!wanted) return null;
  return rates.find((rate) => rate.groupName.trim().toLowerCase() === wanted) ?? null;
}

/**
 * Resolve billing multipliers for one provider attempt.
 *
 * site_group_ratio:
 *   - prefer website group ratio
 *   - if completion_ratio > 0, treat it as output multiplier and keep ratio for input/cache
 * catalog_estimate:
 *   - keep legacy provider.cost_multiplier (group multiplier still applied by caller)
 */
export function resolveSiteBillingMultipliers(input: {
  billingMode?: string | null;
  providerCostMultiplier?: number | string | null;
  siteGroupName?: string | null;
  siteGroupRates?: SiteGroupRateLike[] | null;
}): ResolvedSiteBillingMultipliers {
  const mode: ProviderBillingMode =
    input.billingMode === "site_group_ratio" ? "site_group_ratio" : "catalog_estimate";
  const providerMultiplier = Math.max(0, toFiniteNumber(input.providerCostMultiplier, 1));

  if (mode !== "site_group_ratio") {
    return {
      mode,
      multiplier: providerMultiplier,
      outputMultiplier: null,
      groupName: input.siteGroupName ?? null,
      source: "provider_cost_multiplier",
    };
  }

  const rate = findSiteGroupRate(input.siteGroupRates, input.siteGroupName);
  if (!rate) {
    return {
      mode,
      multiplier: providerMultiplier,
      outputMultiplier: null,
      groupName: input.siteGroupName ?? null,
      source: "fallback",
    };
  }

  const ratio = Math.max(0, toFiniteNumber(rate.ratio, providerMultiplier));
  const completionRatio = Math.max(0, toFiniteNumber(rate.completionRatio, 0));

  return {
    mode,
    multiplier: ratio,
    outputMultiplier: completionRatio > 0 ? completionRatio : null,
    groupName: rate.groupName,
    source: "site_group_rate",
  };
}

/**
 * Apply site-group completion ratio only when upstream provides a real one.
 * Current UH snapshots usually have completion_ratio=0, so this is a no-op and
 * the whole request uses the group ratio.
 */
export function applySiteGroupCompletionRatio(input: {
  rawInputCost: number;
  rawOutputCost: number;
  rawOtherCost?: number;
  multipliers: ResolvedSiteBillingMultipliers;
  groupMultiplier?: number;
}): number {
  const groupMultiplier = Math.max(0, input.groupMultiplier ?? 1);
  const other = Math.max(0, input.rawOtherCost ?? 0);
  const inputCost = Math.max(0, input.rawInputCost);
  const outputCost = Math.max(0, input.rawOutputCost);

  if (input.multipliers.outputMultiplier == null) {
    return (inputCost + outputCost + other) * input.multipliers.multiplier * groupMultiplier;
  }

  return (
    (inputCost * input.multipliers.multiplier +
      outputCost * input.multipliers.outputMultiplier +
      other * input.multipliers.multiplier) *
    groupMultiplier
  );
}
