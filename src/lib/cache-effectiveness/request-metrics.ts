export type RequestCacheMetricAvailability =
  | "available"
  | "no_input"
  | "no_affinity_key"
  | "attempt_failed"
  | "not_observable"
  | "stream_truncated"
  | "not_recorded";

export interface RequestCacheMetricsInput {
  inputTokens: number | null | undefined;
  cacheCreationInputTokens: number | null | undefined;
  cacheReadInputTokens: number | null | undefined;
  theoreticalCacheTokens: number | null | undefined;
  cacheScoreEligible: boolean | null | undefined;
  cacheScoreExcludedReason: string | null | undefined;
  sessionIdentityKind: "session_id" | "prefix_affinity" | null | undefined;
}

export interface RequestCacheMetrics {
  cacheInputTotal: number;
  actualCacheRate: number | null;
  theoreticalCacheRate: number | null;
  requestCacheCoefficientBp: number | null;
  requestCacheMetricAvailability: RequestCacheMetricAvailability;
}

const EXCLUDED_REASONS = new Set<RequestCacheMetricAvailability>([
  "attempt_failed",
  "not_observable",
  "stream_truncated",
]);

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function normalizeExcludedReason(
  reason: string | null | undefined
): RequestCacheMetricAvailability | null {
  if (!reason) return null;
  if (reason === "attempt_failed" || reason === "not_observable" || reason === "stream_truncated") {
    return reason;
  }
  if (reason === "no_affinity_key") return "no_affinity_key";
  return null;
}

/**
 * Derive the three request-level cache metrics from persisted token provenance.
 * The coefficient is the raw single-request ratio; provider-window confidence is
 * intentionally not applied here.
 */
export function deriveRequestCacheMetrics(input: RequestCacheMetricsInput): RequestCacheMetrics {
  const cacheInputTotal =
    finiteNonNegative(input.inputTokens) +
    finiteNonNegative(input.cacheCreationInputTokens) +
    finiteNonNegative(input.cacheReadInputTokens);
  const actualCacheRate =
    cacheInputTotal > 0
      ? clamp01(finiteNonNegative(input.cacheReadInputTokens) / cacheInputTotal)
      : null;

  const hasAnyF3bField =
    input.theoreticalCacheTokens != null ||
    input.cacheScoreEligible != null ||
    input.cacheScoreExcludedReason != null;
  const theoreticalTokens =
    input.theoreticalCacheTokens == null ? null : finiteNonNegative(input.theoreticalCacheTokens);
  const normalizedReason = normalizeExcludedReason(input.cacheScoreExcludedReason);

  if (!hasAnyF3bField) {
    return {
      cacheInputTotal,
      actualCacheRate,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "not_recorded",
    };
  }

  if (normalizedReason) {
    if (cacheInputTotal <= 0) {
      return {
        cacheInputTotal,
        actualCacheRate: null,
        theoreticalCacheRate: null,
        requestCacheCoefficientBp: null,
        requestCacheMetricAvailability: normalizedReason,
      };
    }

    const theoreticalCacheRate =
      theoreticalTokens != null ? clamp01(theoreticalTokens / cacheInputTotal) : null;
    return {
      cacheInputTotal,
      actualCacheRate,
      theoreticalCacheRate,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: normalizedReason,
    };
  }

  if (cacheInputTotal <= 0) {
    return {
      cacheInputTotal,
      actualCacheRate: null,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "no_input",
    };
  }

  const availability = theoreticalTokens == null ? "no_affinity_key" : "available";
  const theoreticalCacheRate =
    theoreticalTokens != null ? clamp01(theoreticalTokens / cacheInputTotal) : null;
  const coefficientAvailable =
    theoreticalTokens != null &&
    theoreticalTokens > 0 &&
    input.cacheScoreEligible !== false &&
    !EXCLUDED_REASONS.has(availability);
  const requestCacheCoefficientBp = coefficientAvailable
    ? Math.min(
        Math.max(
          Math.trunc((finiteNonNegative(input.cacheReadInputTokens) * 10000) / theoreticalTokens),
          0
        ),
        10000
      )
    : null;

  return {
    cacheInputTotal,
    actualCacheRate,
    theoreticalCacheRate,
    requestCacheCoefficientBp,
    requestCacheMetricAvailability: availability,
  };
}
