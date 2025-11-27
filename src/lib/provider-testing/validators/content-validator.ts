/**
 * Content Validator (Tier 2 & 3)
 * Validates response content contains expected string
 * Based on relay-pulse implementation
 */

import type { TestStatus, TestSubStatus } from "../types";

export interface ContentValidationResult {
  status: TestStatus;
  subStatus: TestSubStatus;
  contentPassed: boolean;
}

/**
 * Evaluate content validation on a response
 *
 * Rules from relay-pulse:
 * 1. If no successContains configured, skip validation
 * 2. If already RED, no need to validate (can't get worse)
 * 3. If rate_limit (429), skip content validation (error response)
 * 4. Empty response = content mismatch
 * 5. Check if response contains expected content
 */
export function evaluateContentValidation(
  baseStatus: TestStatus,
  baseSubStatus: TestSubStatus,
  responseBody: string,
  successContains?: string
): ContentValidationResult {
  // No validation configured - pass through
  if (!successContains) {
    return {
      status: baseStatus,
      subStatus: baseSubStatus,
      contentPassed: true,
    };
  }

  // Already red - no need to validate (can't get worse)
  if (baseStatus === "red") {
    return {
      status: baseStatus,
      subStatus: baseSubStatus,
      contentPassed: false,
    };
  }

  // 429 rate limit: response body is error message, skip content validation
  if (baseSubStatus === "rate_limit") {
    return {
      status: baseStatus,
      subStatus: baseSubStatus,
      contentPassed: false,
    };
  }

  // Empty response = content mismatch
  if (!responseBody || !responseBody.trim()) {
    return {
      status: "red",
      subStatus: "content_mismatch",
      contentPassed: false,
    };
  }

  // Check if response contains expected content
  if (!responseBody.includes(successContains)) {
    return {
      status: "red",
      subStatus: "content_mismatch",
      contentPassed: false,
    };
  }

  // Content validation passed
  return {
    status: baseStatus,
    subStatus: baseSubStatus,
    contentPassed: true,
  };
}

/**
 * Extract readable text content from various response formats
 * This is a simplified version - actual parsing is done in parsers
 */
export function extractTextContent(responseBody: string): string {
  // Try to parse as JSON and extract common text fields
  try {
    const obj = JSON.parse(responseBody);

    // Anthropic format
    if (obj.content && Array.isArray(obj.content)) {
      return obj.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("");
    }

    // OpenAI format
    if (obj.choices && Array.isArray(obj.choices)) {
      return obj.choices
        .map(
          (c: { message?: { content: string }; text?: string }) =>
            c.message?.content || c.text || ""
        )
        .join("");
    }

    // Codex Response API format
    if (obj.output && Array.isArray(obj.output)) {
      return obj.output
        .flatMap(
          (o: { content?: Array<{ text?: string }> }) =>
            o.content?.map((c) => c.text || "").filter(Boolean) || []
        )
        .join("");
    }

    // Gemini format
    if (obj.candidates && Array.isArray(obj.candidates)) {
      return obj.candidates
        .flatMap(
          (c: { content?: { parts?: Array<{ text?: string }> } }) =>
            c.content?.parts?.map((p) => p.text || "").filter(Boolean) || []
        )
        .join("");
    }

    // Direct content field
    if (typeof obj.content === "string") {
      return obj.content;
    }

    // Direct text field
    if (typeof obj.text === "string") {
      return obj.text;
    }
  } catch {
    // Not JSON, return as-is
  }

  return responseBody;
}
