/**
 * Provider Availability Module
 *
 * This module provides availability monitoring based on request log data.
 * Availability is calculated only from finalized requests that already have a persisted
 * `statusCode`. In-flight / intermediate records are excluded upstream.
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
