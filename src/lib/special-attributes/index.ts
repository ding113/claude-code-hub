/**
 * Special Attributes Module
 *
 * Centralized module for managing special features like 1M context window,
 * extended cache TTL, and other provider-specific capabilities.
 */

// =============================================================================
// 1M Context Window Support
// =============================================================================

/**
 * Token threshold for tiered pricing (200k tokens)
 */
export const CONTEXT_1M_TOKEN_THRESHOLD = 200000;

/**
 * Pricing multipliers for tokens exceeding the threshold
 * - Input: 2x ($3/MTok -> $6/MTok for tokens >200k)
 * - Output: 1.5x ($15/MTok -> $22.50/MTok for tokens >200k)
 */
export const CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER = 2.0;
export const CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER = 1.5;

/**
 * Check if client request includes context-1m header
 * @param headers - Request headers (Headers object or plain object)
 */
export function clientRequestsContext1m(
  headers: Headers | Record<string, string> | null | undefined
): boolean {
  if (!headers) return false;

  let betaHeader: string | null = null;

  if (headers instanceof Headers) {
    betaHeader = headers.get("anthropic-beta");
  } else {
    // Handle plain object (case-insensitive lookup)
    const key = Object.keys(headers).find((k) => k.toLowerCase() === "anthropic-beta");
    betaHeader = key ? headers[key] : null;
  }

  if (!betaHeader) return false;

  return betaHeader.split(",").some((flag) => {
    const trimmed = flag.trim();
    return trimmed.startsWith("context-1m-");
  });
}

/**
 * Codex context-1m badge threshold (272k tokens)
 * When input tokens exceed this, the 1M context badge is displayed.
 */
export const CODEX_1M_CONTEXT_TOKEN_THRESHOLD = 272000;

// =============================================================================
// Extended Cache TTL Support (Reference)
// =============================================================================

/**
 * Cache TTL beta header for 1-hour extended caching
 */
export const CACHE_1H_BETA_HEADER = "extended-cache-ttl-2025-04-11";

/**
 * Cache TTL preference types
 */
export type CacheTtlPreference = "5m" | "1h" | null;
