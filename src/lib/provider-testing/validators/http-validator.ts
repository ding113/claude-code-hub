/**
 * HTTP Status Validator (Tier 1)
 * Classifies HTTP status codes into test status and sub-status
 * Based on relay-pulse implementation
 */

import { TEST_DEFAULTS, type TestStatus, type TestSubStatus } from "../types";

export interface HttpValidationResult {
  status: TestStatus;
  subStatus: TestSubStatus;
}

/**
 * Classify HTTP status code into test status
 *
 * Classification rules from relay-pulse:
 * - 2xx: GREEN (or YELLOW if slow)
 * - 3xx: GREEN (redirects handled by client)
 * - 400: RED (invalid_request)
 * - 401/403: RED (auth_error)
 * - 429: RED (rate_limit)
 * - 4xx: RED (client_error)
 * - 5xx: RED (server_error)
 */
export function classifyHttpStatus(
  statusCode: number,
  latencyMs: number,
  slowThresholdMs: number = TEST_DEFAULTS.SLOW_LATENCY_MS
): HttpValidationResult {
  // 2xx = Green (or Yellow if slow)
  if (statusCode >= 200 && statusCode < 300) {
    if (latencyMs > slowThresholdMs) {
      return { status: "yellow", subStatus: "slow_latency" };
    }
    return { status: "green", subStatus: "success" };
  }

  // 3xx = Green (redirects handled by HTTP client)
  if (statusCode >= 300 && statusCode < 400) {
    return { status: "green", subStatus: "success" };
  }

  // 401/403 = Red (auth failure)
  if (statusCode === 401 || statusCode === 403) {
    return { status: "red", subStatus: "auth_error" };
  }

  // 400 = Red (invalid request)
  if (statusCode === 400) {
    return { status: "red", subStatus: "invalid_request" };
  }

  // 429 = Red (rate limit)
  if (statusCode === 429) {
    return { status: "red", subStatus: "rate_limit" };
  }

  // 5xx = Red (server error)
  if (statusCode >= 500) {
    return { status: "red", subStatus: "server_error" };
  }

  // Other 4xx = Red (client error)
  if (statusCode >= 400) {
    return { status: "red", subStatus: "client_error" };
  }

  // 1xx or other non-standard = Red (client error)
  return { status: "red", subStatus: "client_error" };
}

/**
 * Check if HTTP status indicates success (2xx or 3xx)
 */
export function isHttpSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 400;
}

/**
 * Get human-readable description for sub-status
 */
export function getSubStatusDescription(subStatus: TestSubStatus): string {
  const descriptions: Record<TestSubStatus, string> = {
    success: "All checks passed",
    slow_latency: "Response was slow but successful",
    rate_limit: "Rate limited (HTTP 429)",
    server_error: "Server error (HTTP 5xx)",
    client_error: "Client error (HTTP 4xx)",
    auth_error: "Authentication failed (HTTP 401/403)",
    invalid_request: "Invalid request (HTTP 400)",
    network_error: "Network connection failed",
    content_mismatch: "Response content validation failed",
  };
  return descriptions[subStatus];
}
