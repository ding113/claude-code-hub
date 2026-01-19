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
 * Model prefixes that support 1M context window
 * Only Sonnet models support this feature as of 2025-08
 * Note: Longer prefixes must come first for correct matching
 */
export const CONTEXT_1M_SUPPORTED_MODEL_PREFIXES = [
  "claude-sonnet-4-5",
  "claude-sonnet-4",
] as const;

/**
 * Anthropic beta header for 1M context window
 */
export const CONTEXT_1M_BETA_HEADER = "context-1m-2025-08-07";

/**
 * Context 1M preference types for provider configuration
 * - 'inherit': Follow client request and passthrough headers for supported models (default)
 * - 'force_enable': Force enable 1M context for supported models
 * - 'disabled': Disable 1M context even if client requests it
 */
export type Context1mPreference = "inherit" | "force_enable" | "disabled";

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
 * Check if a model supports 1M context window
 * Uses prefix matching to handle model variants (e.g., claude-sonnet-4, claude-sonnet-4-20250514)
 */
export function isContext1mSupportedModel(model: string): boolean {
  if (!model) return false;
  return CONTEXT_1M_SUPPORTED_MODEL_PREFIXES.some((prefix) => {
    // Exact match for base model name
    if (model === prefix) return true;
    // Prefix match with dash separator and at least one more character
    const prefixWithDash = `${prefix}-`;
    if (model.startsWith(prefixWithDash) && model.length > prefixWithDash.length) {
      return true;
    }
    return false;
  });
}

/**
 * Determine whether to apply 1M context window based on provider preference and client request
 *
 * @param preference - Provider's context 1M preference setting
 * @param model - The model being used (after any redirects)
 * @param clientRequestedContext1m - Whether client sent context-1m header
 * @returns Whether to apply 1M context window
 */
export function shouldApplyContext1m(
  preference: Context1mPreference | null | undefined,
  model: string,
  clientRequestedContext1m: boolean
): boolean {
  // If provider explicitly disables, never apply
  if (preference === "disabled") {
    return false;
  }

  // If provider force enables, apply for supported models
  if (preference === "force_enable") {
    return isContext1mSupportedModel(model);
  }

  // Default (inherit): follow client request for supported models
  return clientRequestedContext1m && isContext1mSupportedModel(model);
}

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
    return trimmed === CONTEXT_1M_BETA_HEADER || trimmed.startsWith("context-1m-");
  });
}

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
