import type { HedgeLoserBilling } from "@/types/cost-breakdown";
import { Decimal, sumCosts, toDecimal } from "./currency";

/**
 * Derived view of a request's hedge (provider racing) billing split.
 *
 * `total` is the request's grand-total cost (which already includes every loser).
 * `winnerCost` is derived as `total - sum(losers)` so the winner + losers always
 * add up to the displayed total. Rounding can in theory push the derived winner
 * cost slightly below zero; it is clamped to zero.
 */
export interface HedgeBillingSummary {
  /** Grand-total cost (decimal string) — winner + all losers. */
  total: string;
  /** Sum of all loser costs (decimal string). */
  loserTotal: string;
  /** Winner's cost = total - loserTotal, clamped at 0 (decimal string). */
  winnerCost: string;
  /** Per-loser billing entries. */
  losers: HedgeLoserBilling[];
}

/**
 * Build the winner/loser billing split for a request, or null when no hedge
 * loser was billed (the common case — render nothing extra then).
 */
export function summarizeHedgeBilling(
  costUsd: string | null | undefined,
  hedgeLosers: HedgeLoserBilling[] | null | undefined
): HedgeBillingSummary | null {
  if (!hedgeLosers || hedgeLosers.length === 0) {
    return null;
  }

  const loserTotal = sumCosts(hedgeLosers.map((loser) => loser.costUsd));
  const total = toDecimal(costUsd ?? "0") ?? new Decimal(0);
  const winnerDelta = total.minus(loserTotal);
  const winnerCost = winnerDelta.lt(0) ? new Decimal(0) : winnerDelta;

  return {
    total: total.toString(),
    loserTotal: loserTotal.toString(),
    winnerCost: winnerCost.toString(),
    losers: hedgeLosers,
  };
}

/**
 * Look up the billed cost for a specific hedge loser by provider + attempt, used
 * to annotate decision-chain entries. Returns null when not found.
 */
export function findHedgeLoserCost(
  hedgeLosers: HedgeLoserBilling[] | null | undefined,
  providerId: number | null | undefined,
  attemptNumber: number | null | undefined
): HedgeLoserBilling | null {
  if (!hedgeLosers || hedgeLosers.length === 0 || providerId == null) {
    return null;
  }
  return (
    hedgeLosers.find(
      (loser) =>
        loser.providerId === providerId &&
        (attemptNumber == null || loser.attemptNumber === attemptNumber)
    ) ?? null
  );
}
