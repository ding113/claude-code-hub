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
  /** Base cache creation cost (no multiplier) */
  cache_creation: string;
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
}
