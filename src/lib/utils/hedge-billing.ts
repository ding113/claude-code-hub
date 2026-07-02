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
 * One row of the per-attempt hedge billing table: the winner plus each billed
 * loser, each carrying its reclaimed token usage and its billed cost so the UI
 * can show exactly how the merged request total was composed.
 */
export interface HedgeAttemptRow {
  kind: "winner" | "loser";
  providerId: number | null;
  providerName: string | null;
  /** Hedge attempt sequence (1 = initial provider); null when unknown. */
  attemptNumber: number | null;
  /** Billed cost (decimal string) for this attempt. */
  costUsd: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Full per-attempt billing breakdown for a hedged request: the winner row plus
 * one row per billed loser, with summed token totals and the grand total. The
 * request list tooltips and the detail dialog billing card derive from this; the
 * decision chain derives from the same {@link summarizeHedgeBilling} primitive,
 * so all surfaces agree on the winner/loser/total figures.
 */
export interface HedgeBillingTable {
  /** Winner first, then losers ordered by attempt number. */
  attempts: HedgeAttemptRow[];
  /** Grand-total cost (decimal string) — winner + all losers. */
  total: string;
  /** Winner's cost = total - sum(losers), clamped at 0 (decimal string). */
  winnerCost: string;
  /** Number of billed attempts (1 winner + N losers). */
  count: number;
  /** Whether any attempt read from cache (controls the cache-read column). */
  hasCacheRead: boolean;
  /** Whether any attempt wrote to cache (controls the cache-write column). */
  hasCacheWrite: boolean;
  /** Token usage summed across every attempt. */
  tokenTotals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

/** Winner token/identity context (from the finalized request row). */
export interface HedgeWinnerInput {
  providerId?: number | null;
  providerName?: string | null;
  attemptNumber?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

function toCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Build the per-attempt billing table for a hedged request, or null when no
 * hedge loser was billed (the common case — render nothing extra then). The
 * winner's token usage comes from the finalized request row; each loser's usage
 * is read from its stored billing entry.
 */
export function buildHedgeBillingTable(
  costUsd: string | null | undefined,
  hedgeLosers: HedgeLoserBilling[] | null | undefined,
  winner?: HedgeWinnerInput
): HedgeBillingTable | null {
  const summary = summarizeHedgeBilling(costUsd, hedgeLosers);
  if (!summary) {
    return null;
  }

  const winnerRow: HedgeAttemptRow = {
    kind: "winner",
    providerId: winner?.providerId ?? null,
    providerName: winner?.providerName ?? null,
    attemptNumber: winner?.attemptNumber ?? null,
    costUsd: summary.winnerCost,
    inputTokens: toCount(winner?.inputTokens),
    outputTokens: toCount(winner?.outputTokens),
    cacheCreationInputTokens: toCount(winner?.cacheCreationInputTokens),
    cacheReadInputTokens: toCount(winner?.cacheReadInputTokens),
  };

  const loserRows: HedgeAttemptRow[] = summary.losers
    .toSorted((a, b) => a.attemptNumber - b.attemptNumber)
    .map((loser) => ({
      kind: "loser" as const,
      providerId: loser.providerId,
      providerName: loser.providerName,
      attemptNumber: loser.attemptNumber,
      costUsd: loser.costUsd,
      inputTokens: toCount(loser.inputTokens),
      outputTokens: toCount(loser.outputTokens),
      cacheCreationInputTokens: toCount(loser.cacheCreationInputTokens),
      cacheReadInputTokens: toCount(loser.cacheReadInputTokens),
    }));

  const attempts = [winnerRow, ...loserRows];
  const tokenTotals = attempts.reduce(
    (acc, attempt) => ({
      inputTokens: acc.inputTokens + attempt.inputTokens,
      outputTokens: acc.outputTokens + attempt.outputTokens,
      cacheCreationInputTokens: acc.cacheCreationInputTokens + attempt.cacheCreationInputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + attempt.cacheReadInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
  );

  return {
    attempts,
    total: summary.total,
    winnerCost: summary.winnerCost,
    count: attempts.length,
    hasCacheRead: attempts.some((attempt) => attempt.cacheReadInputTokens > 0),
    hasCacheWrite: attempts.some((attempt) => attempt.cacheCreationInputTokens > 0),
    tokenTotals,
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
