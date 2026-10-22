import type { StoredCostBreakdown } from "@/types/cost-breakdown";

/**
 * Per-token price of each cache bucket relative to the input price, derived from the
 * stored cost breakdown. Replaces fixed Anthropic ratios (1.25x / 2x / 0.1x) in log
 * displays, since other vendors price cache tokens differently (e.g. xAI reads at 0.25x).
 * A ratio is null when it cannot be derived (no breakdown, zero tokens, zero input cost).
 */
export interface CacheCostRatios {
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  cacheRead: number | null;
}

export interface CacheCostRatioInput {
  costBreakdown: StoredCostBreakdown | null | undefined;
  inputTokens: number | null | undefined;
  /** Token counts as displayed in each row */
  cacheWrite5mTokens: number | null | undefined;
  cacheWrite1hTokens: number | null | undefined;
  cacheReadTokens: number | null | undefined;
}

const EMPTY_RATIOS: CacheCostRatios = { cacheWrite5m: null, cacheWrite1h: null, cacheRead: null };

function toPositiveCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toCost(value: string | undefined): number | null {
  if (value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function resolveCacheCostRatios(input: CacheCostRatioInput): CacheCostRatios {
  const breakdown = input.costBreakdown;
  if (!breakdown) return EMPTY_RATIOS;

  const inputTokens = toPositiveCount(input.inputTokens);
  const inputCost = toCost(breakdown.input);
  if (inputTokens === 0 || inputCost === null || inputCost === 0) return EMPTY_RATIOS;
  const inputRate = inputCost / inputTokens;

  const ratioOf = (cost: number | null, tokens: number): number | null => {
    if (cost === null || tokens === 0) return null;
    return cost / tokens / inputRate;
  };

  const tokens5m = toPositiveCount(input.cacheWrite5mTokens);
  const tokens1h = toPositiveCount(input.cacheWrite1hTokens);
  const hasPerTtlCost =
    breakdown.cache_creation_5m !== undefined || breakdown.cache_creation_1h !== undefined;

  let cost5m: number | null = null;
  let cost1h: number | null = null;
  if (hasPerTtlCost) {
    cost5m = toCost(breakdown.cache_creation_5m ?? "0");
    cost1h = toCost(breakdown.cache_creation_1h ?? "0");
  } else if (tokens5m === 0 || tokens1h === 0) {
    // Legacy rows only store the aggregate; attributable only when a single TTL is present.
    const aggregate = toCost(breakdown.cache_creation);
    cost5m = tokens5m > 0 ? aggregate : null;
    cost1h = tokens1h > 0 ? aggregate : null;
  }

  return {
    cacheWrite5m: ratioOf(cost5m, tokens5m),
    cacheWrite1h: ratioOf(cost1h, tokens1h),
    cacheRead: ratioOf(toCost(breakdown.cache_read), toPositiveCount(input.cacheReadTokens)),
  };
}

/** Formats a ratio as "0.25x"; returns null when the ratio is unknown. */
export function formatCacheCostRatio(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return `${Number(ratio.toFixed(2))}x`;
}
