/**
 * Provider Testing Service
 * Main entry point for unified provider testing
 *
 * Implements three-tier validation from relay-pulse:
 * 1. HTTP Status Code validation
 * 2. Latency threshold validation
 * 3. Content validation (success_contains)
 */

import { getPreset, getPresetPayload } from "./presets";
import type {
  ProviderTestConfig,
  ProviderTestResult,
  TestStatus,
  TestSubStatus,
  ValidationDetails,
} from "./types";
import { TEST_DEFAULTS } from "./types";
import {
  DEFAULT_SUCCESS_CONTAINS,
  getTestBody,
  getTestHeaders,
  getTestUrl,
} from "./utils/test-prompts";
import { evaluateContentValidation } from "./validators/content-validator";
import { classifyHttpStatus } from "./validators/http-validator";

/**
 * Execute a provider test with three-tier validation
 */
export async function executeProviderTest(config: ProviderTestConfig): Promise<ProviderTestResult> {
  const startTime = Date.now();
  let firstByteMs: number | undefined;

  // Build test configuration with defaults
  const timeoutMs = config.timeoutMs ?? TEST_DEFAULTS.TIMEOUT_MS;
  const slowThresholdMs = config.latencyThresholdMs ?? TEST_DEFAULTS.SLOW_LATENCY_MS;

  // Determine success validation string (priority: config > preset > default)
  let successContains = config.successContains;
  if (!successContains && config.preset) {
    const preset = getPreset(config.preset);
    successContains = preset?.defaultSuccessContains;
  }
  successContains ??= DEFAULT_SUCCESS_CONTAINS[config.providerType];

  // Build request URL
  const url = getTestUrl(
    config.providerUrl,
    config.providerType,
    config.model,
    // Only pass API key for Gemini (URL parameter)
    config.providerType === "gemini" || config.providerType === "gemini-cli"
      ? config.apiKey
      : undefined
  );

  // Build request body (priority: customPayload > preset > default)
  let body: Record<string, unknown>;
  if (config.customPayload) {
    // User-provided custom payload
    try {
      body = JSON.parse(config.customPayload);
    } catch {
      throw new Error("Invalid custom payload JSON");
    }
  } else if (config.preset) {
    // Use preset configuration
    body = getPresetPayload(config.preset, config.model);
  } else {
    // Use default test body
    body = getTestBody(config.providerType, config.model);
  }

  // Build request headers (merge custom headers if provided)
  const baseHeaders = getTestHeaders(config.providerType, config.apiKey);
  const headers = config.customHeaders ? { ...baseHeaders, ...config.customHeaders } : baseHeaders;

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Execute request
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      firstByteMs = Date.now() - startTime;

      // Read response body
      const responseBody = await response.text();
      const latencyMs = Date.now() - startTime;
      const _contentType = response.headers.get("content-type") || undefined;

      // Tier 1: HTTP Status validation
      const httpResult = classifyHttpStatus(response.status, latencyMs, slowThresholdMs);

      // Tier 2 & 3: Content validation - SIMPLIFIED: directly match raw response body
      // No SSE/JSON parsing needed - just check if successContains exists in raw response
      // This is the most reliable approach as relay-pulse also falls back to raw body
      const contentResult = evaluateContentValidation(
        httpResult.status,
        httpResult.subStatus,
        responseBody, // Use raw response body directly
        successContains
      );

      // Try to extract model from response (simple JSON extraction)
      let model: string | undefined;
      try {
        // Try to parse as JSON for model extraction only
        const parsed = JSON.parse(responseBody);
        model = parsed.model;
      } catch {
        // Not JSON or parsing failed - that's fine, model is optional
      }

      // Build validation details
      const validationDetails: ValidationDetails = {
        httpPassed: response.ok,
        httpStatusCode: response.status,
        latencyPassed: latencyMs <= slowThresholdMs,
        latencyMs,
        contentPassed: contentResult.contentPassed,
        contentTarget: successContains,
      };

      // Build result with raw response for user inspection
      return {
        success: contentResult.status !== "red",
        status: contentResult.status,
        subStatus: contentResult.subStatus,
        latencyMs,
        firstByteMs,
        httpStatusCode: response.status,
        httpStatusText: response.statusText,
        model,
        content: responseBody.slice(0, 500), // Preview for quick view
        rawResponse: responseBody.slice(0, 5000), // Full response for detailed inspection
        testedAt: new Date(),
        validationDetails,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Classify error type
    const { subStatus, errorType, errorMessage } = classifyError(error);

    // Build validation details for failure
    const validationDetails: ValidationDetails = {
      httpPassed: false,
      latencyPassed: false,
      latencyMs,
      contentPassed: false,
      contentTarget: successContains,
    };

    return {
      success: false,
      status: "red",
      subStatus,
      latencyMs,
      firstByteMs,
      errorMessage,
      errorType,
      rawError: error,
      testedAt: new Date(),
      validationDetails,
    };
  }
}

/**
 * Classify error into sub-status and message
 */
function classifyError(error: unknown): {
  subStatus: TestSubStatus;
  errorType: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Timeout errors
    if (error.name === "AbortError" || message.includes("timeout") || message.includes("aborted")) {
      return {
        subStatus: "network_error",
        errorType: "timeout",
        errorMessage: "Request timed out",
      };
    }

    // DNS/connection errors
    if (
      message.includes("getaddrinfo") ||
      message.includes("enotfound") ||
      message.includes("dns")
    ) {
      return {
        subStatus: "network_error",
        errorType: "dns_error",
        errorMessage: "DNS resolution failed",
      };
    }

    // Connection refused
    if (message.includes("econnrefused") || message.includes("connection refused")) {
      return {
        subStatus: "network_error",
        errorType: "connection_refused",
        errorMessage: "Connection refused",
      };
    }

    // Connection reset
    if (message.includes("econnreset") || message.includes("connection reset")) {
      return {
        subStatus: "network_error",
        errorType: "connection_reset",
        errorMessage: "Connection reset by peer",
      };
    }

    // SSL/TLS errors
    if (message.includes("ssl") || message.includes("tls") || message.includes("certificate")) {
      return {
        subStatus: "network_error",
        errorType: "ssl_error",
        errorMessage: "SSL/TLS error",
      };
    }

    // Generic network error
    return {
      subStatus: "network_error",
      errorType: "network_error",
      errorMessage: error.message,
    };
  }

  // Unknown error type
  return {
    subStatus: "network_error",
    errorType: "unknown_error",
    errorMessage: String(error),
  };
}

/**
 * Get availability weight for a status
 * Used for calculating weighted availability scores
 */
export function getStatusWeight(
  status: TestStatus,
  degradedWeight: number = TEST_DEFAULTS.DEGRADED_WEIGHT
): number {
  switch (status) {
    case "green":
      return 1.0;
    case "yellow":
      return degradedWeight;
    case "red":
      return 0.0;
  }
}
