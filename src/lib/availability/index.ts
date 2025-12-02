/**
 * Provider Availability Module
 *
 * This module provides availability monitoring based on request log data.
 * Simple two-tier validation: success or failure.
 *
 * 1. HTTP Status Check: 2xx/3xx = success (green), 4xx/5xx or error = failure (red)
 *
 * Availability scoring:
 * - GREEN (1.0): Successful requests (any HTTP 2xx/3xx)
 * - RED (0.0): Failed requests (HTTP 4xx/5xx or network error)
 * - UNKNOWN: No data available
 */

export {
  calculateAvailabilityScore,
  classifyRequestStatus,
  determineOptimalBucketSize,
  getCurrentProviderStatus,
  queryProviderAvailability,
} from "./availability-service";
export * from "./types";
