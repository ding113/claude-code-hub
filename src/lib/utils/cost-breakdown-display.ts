import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import { Decimal, toDecimal } from "@/lib/utils/currency";

/**
 * Normalize cost_breakdown from API/DB.
 * Handles: object, JSON string, camelCase aliases, null/undefined.
 * No synthetic / reverse-engineered fallback — only real stored breakdown.
 */
export function normalizeStoredCostBreakdown(value: unknown): StoredCostBreakdown | null {
  if (value == null) return null;
  let obj: unknown = value;
  // Tolerate double-encoded JSON strings from some drivers/paths.
  for (let i = 0; i < 2; i++) {
    if (typeof obj === "string") {
      const trimmed = obj.trim();
      if (!trimmed) return null;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return null;
      }
      continue;
    }
    break;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;

  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (rec[k] != null && rec[k] !== "") return rec[k];
    }
    return undefined;
  };

  const input = pick("input", "inputCost", "input_cost");
  const output = pick("output", "outputCost", "output_cost");
  const cacheRead = pick("cache_read", "cacheRead", "cache_read_cost");
  const cacheCreation = pick("cache_creation", "cacheCreation", "cache_creation_cost");
  const baseTotal = pick("base_total", "baseTotal", "base_cost");
  const total = pick("total", "totalCost", "total_cost");
  const providerMult = pick("provider_multiplier", "providerMultiplier", "cost_multiplier");
  const groupMult = pick("group_multiplier", "groupMultiplier", "group_cost_multiplier");
  const cache5m = pick("cache_creation_5m", "cacheCreation5m");
  const cache1h = pick("cache_creation_1h", "cacheCreation1h");

  // Require at least one of the core fields so we don't treat empty {} as breakdown.
  if (
    input == null &&
    output == null &&
    baseTotal == null &&
    total == null &&
    cacheRead == null
  ) {
    return null;
  }

  const toNum = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    input: String(input ?? "0"),
    output: String(output ?? "0"),
    cache_creation: String(cacheCreation ?? "0"),
    cache_creation_5m: cache5m != null ? String(cache5m) : undefined,
    cache_creation_1h: cache1h != null ? String(cache1h) : undefined,
    cache_read: String(cacheRead ?? "0"),
    base_total: String(baseTotal ?? total ?? "0"),
    provider_multiplier: toNum(providerMult, 1),
    group_multiplier: toNum(groupMult, 1),
    total: String(total ?? baseTotal ?? "0"),
  };
}

/**
 * Display only the real stored cost_breakdown written at billing time
 * (model price × tokens, then × multipliers for total).
 * Never invent line items from token weights.
 */
export function resolveCostBreakdownForDisplay(args: {
  costBreakdown?: unknown;
  /** @deprecated ignored — kept so call sites need not change; no synthesize */
  costUsd?: string | number | null;
  providerMultiplier?: string | number | null;
  groupMultiplier?: string | number | null;
  /** @deprecated ignored — no token-weight fallback */
  tokens?: unknown;
}): StoredCostBreakdown | null {
  const raw = args.costBreakdown ?? (args as { cost_breakdown?: unknown }).cost_breakdown;
  const stored = normalizeStoredCostBreakdown(raw);
  if (!stored) return null;

  // Fill missing multipliers from row-level fields when stored as 1/default.
  const pm = Number(args.providerMultiplier);
  const gm = Number(args.groupMultiplier);
  if (
    (stored.provider_multiplier == null || stored.provider_multiplier === 1) &&
    Number.isFinite(pm) &&
    pm > 0 &&
    pm !== 1
  ) {
    stored.provider_multiplier = pm;
  }
  if (
    (stored.group_multiplier == null || stored.group_multiplier === 1) &&
    Number.isFinite(gm) &&
    gm > 0 &&
    gm !== 1
  ) {
    stored.group_multiplier = gm;
  }
  return stored;
}

/**
 * Display unit price for a cost line.
 * Product rule: **real model unit price after multiplier** =
 *   (base_line_amount / tokens) * 1M * provider_mult * group_mult
 *
 * Stored cost_breakdown amounts are **pre-multiplier base**
 * (see calculateRequestCostBreakdown).
 */
export function computeDisplayUnitPricePer1M(args: {
  lineAmount: string | number | null | undefined;
  tokens: number | null | undefined;
  /** When true, lineAmount is base (pre mult) — multiply by mult for display unit. */
  amountIsBase: boolean;
  providerMultiplier?: number | null;
  groupMultiplier?: number | null;
}): Decimal | null {
  const amount = toDecimal(args.lineAmount);
  const tokens = args.tokens ?? 0;
  if (!amount || amount.lte(0) || tokens <= 0) return null;

  let unit = amount.mul(1_000_000).div(tokens);
  if (args.amountIsBase) {
    const pm =
      args.providerMultiplier != null &&
      Number.isFinite(args.providerMultiplier) &&
      args.providerMultiplier > 0
        ? args.providerMultiplier
        : 1;
    const gm =
      args.groupMultiplier != null &&
      Number.isFinite(args.groupMultiplier) &&
      args.groupMultiplier > 0
        ? args.groupMultiplier
        : 1;
    unit = unit.mul(pm).mul(gm);
  }
  return unit;
}

/** Line amounts in StoredCostBreakdown are base (pre provider/group multiplier). */
export function isStoredBreakdownAmountBase(): boolean {
  return true;
}
