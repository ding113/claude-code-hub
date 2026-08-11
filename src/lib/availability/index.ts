/**
 * Provider Availability Module
 *
 * Read path aggregates pre-projected 1-minute buckets (avail_bucket_1m / avail_current).
 * Write path finalization still relies on message_request.statusCode: a DB trigger enqueues
 * outbox events, and the in-process projection worker increments the buckets.
 * In-flight / intermediate records never enter the projection.
 *
 * 1. HTTP Status Check: 2xx/3xx = success (green), other finalized HTTP status codes = failure (red)
 *
 * Availability scoring:
 * - GREEN (1.0): Successful requests (any HTTP 2xx/3xx)
 * - RED (0.0): Failed finalized requests (non-2xx/3xx HTTP status codes)
 * - UNKNOWN: No data available
 */

export {
  AvailabilityQueryValidationError,
  calculateAvailabilityScore,
  classifyRequestStatus,
  determineOptimalBucketSize,
  getCurrentProviderStatus,
  MAX_AVAILABILITY_QUERY_RANGE_DAYS,
  MAX_BUCKET_SIZE_MINUTES,
  MAX_BUCKETS_HARD_LIMIT,
  MIN_BUCKET_SIZE_MINUTES,
  queryProviderAvailability,
} from "./availability-service";
export * from "./types";
