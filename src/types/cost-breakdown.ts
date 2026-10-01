/**
 * Stored cost breakdown for a request.
 * Persisted as jsonb in messageRequest.costBreakdown.
 * All cost values are Decimal strings for precision.
 */
export interface StoredCostBreakdown {
  /** Base input cost (no multiplier) */
  input: string;
  /** Base output cost (no multiplier) */
  output: string;
  /**
   * Base cache creation cost aggregated across 5m + 1h TTLs (no multiplier).
   * Retained for backward compatibility; use cache_creation_5m / _1h for per-TTL display.
   */
  cache_creation: string;
  /** Base cache creation cost for 5-minute TTL only (no multiplier). Optional for historical rows. */
  cache_creation_5m?: string;
  /** Base cache creation cost for 1-hour TTL only (no multiplier). Optional for historical rows. */
  cache_creation_1h?: string;
  /** Base cache read cost (no multiplier) */
  cache_read: string;
  /** Sum of all base costs before multipliers */
  base_total: string;
  /** Provider cost multiplier applied */
  provider_multiplier: number;
  /** Provider group cost multiplier applied */
  group_multiplier: number;
  /** Final total cost after both multipliers */
  total: string;
  /** Long-context tier applied to the whole request. Absent when no tier was hit. */
  long_context?: StoredLongContextTier;
}

/**
 * Long-context tier hit: once the request's input context exceeds the threshold, every billed
 * dimension of the whole request uses its tier unit price.
 * Each multiplier is the tier unit price divided by the unit price that applies without the tier;
 * a multiplier is absent when that dimension has no tier price.
 */
export interface StoredLongContextTier {
  /** The tier applies when observed_input_tokens is strictly greater than this value */
  threshold_tokens: number;
  /** Input context of the request: input + cache creation + cache read + image input tokens */
  observed_input_tokens: number;
  input_multiplier?: number;
  output_multiplier?: number;
  cache_creation_5m_multiplier?: number;
  cache_creation_1h_multiplier?: number;
  cache_read_multiplier?: number;
}

/**
 * Billing record for a single hedge (provider racing) loser whose upstream
 * response was drained in the background and billed.
 *
 * Persisted as one element of the jsonb array `messageRequest.hedgeLosers`.
 * Each loser's `costUsd` is already accumulated into the row's grand-total
 * `costUsd`; this array only keeps the per-loser breakdown for display.
 * All cost values are Decimal strings for precision.
 */
export interface HedgeLoserBilling {
  /** Losing provider id */
  providerId: number;
  /** Losing provider name (snapshot, for display) */
  providerName: string;
  /** Hedge attempt sequence number (1 = initial provider) */
  attemptNumber: number;
  /** Billed cost (USD) for this loser, with multipliers applied */
  costUsd: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}
