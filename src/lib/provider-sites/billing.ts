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
  type ClassifiableProviderGroup,
  classifySiteGroupTagWithGroups,
} from "@/lib/provider-groups/match-rules";

export type ProviderBillingMode = "catalog_estimate" | "site_group_ratio";

export type SiteGroupRateLike = {
  groupName: string;
  ratio: number | string;
  effectiveRatio?: number | string;
  completionRatio?: number | string | null;
  effectiveCompletionRatio?: number | string | null;
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
 * Resolve the site's recharge multiplier used to convert upstream prices and
 * balances into CCH-facing values. Zero/invalid values are fail-safe to 1.
 */
export function resolveRechargeMultiplier(value: unknown): number {
  const multiplier = toFiniteNumber(value, 1);
  return multiplier > 0 ? multiplier : 1;
}

/** Upstream group ratio after applying the site's recharge multiplier. */
export function normalizeUpstreamRate(value: unknown, rechargeMultiplier?: unknown): number {
  return Math.max(0, toFiniteNumber(value, 0)) / resolveRechargeMultiplier(rechargeMultiplier);
}

/** Upstream balance after applying the site's recharge multiplier. */
export function resolveSiteBalance(value: unknown, rechargeMultiplier?: unknown): number | null {
  if (value == null) return null;
  const balance = toFiniteNumber(value, Number.NaN);
  return Number.isFinite(balance) ? balance / resolveRechargeMultiplier(rechargeMultiplier) : null;
}

/** Upstream cost after applying the site's recharge multiplier (real money spent). */
export function resolveSiteCost(value: unknown, rechargeMultiplier?: unknown): number | null {
  if (value == null) return null;
  const cost = toFiniteNumber(value, Number.NaN);
  return Number.isFinite(cost) ? cost / resolveRechargeMultiplier(rechargeMultiplier) : null;
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
  siteRechargeMultiplier?: number | string | null;
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

  const ratio =
    rate.effectiveRatio !== undefined
      ? normalizeUpstreamRate(rate.effectiveRatio)
      : normalizeUpstreamRate(rate.ratio, input.siteRechargeMultiplier);
  const completionRatio =
    rate.effectiveCompletionRatio !== undefined
      ? normalizeUpstreamRate(rate.effectiveCompletionRatio)
      : normalizeUpstreamRate(rate.completionRatio, input.siteRechargeMultiplier);

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
