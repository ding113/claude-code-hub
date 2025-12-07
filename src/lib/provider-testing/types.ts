/**
 * Provider Testing Service Types
 * Based on relay-pulse implementation patterns
 */

import type { ProviderType } from "@/types/provider";

// ============================================================================
// Test Status Types (3-level system from relay-pulse)
// ============================================================================

/**
 * Primary test status
 * - green: All validations passed
 * - yellow: HTTP OK but degraded (slow latency)
 * - red: Any failure
 */
export type TestStatus = "green" | "yellow" | "red";

/**
 * Detailed sub-status for granular error classification
 * Maps to relay-pulse's 8 SubStatus categories
 */
export type TestSubStatus =
  | "success" // All validations passed
  | "slow_latency" // HTTP OK but latency exceeds threshold
  | "rate_limit" // HTTP 429
  | "server_error" // HTTP 5xx
  | "client_error" // HTTP 4xx (excluding specific codes)
  | "auth_error" // HTTP 401/403
  | "invalid_request" // HTTP 400
  | "network_error" // Connection/DNS/timeout errors
  | "content_mismatch"; // Response content validation failed

/**
 * Numeric status values for availability calculation
 * Matches relay-pulse internal representation
 */
export const STATUS_VALUES = {
  GREEN: 1,
  YELLOW: 2,
  RED: 0,
  MISSING: -1,
} as const;

export type StatusValue = (typeof STATUS_VALUES)[keyof typeof STATUS_VALUES];

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Default configuration constants from relay-pulse
 */
export const TEST_DEFAULTS = {
  /** Total request timeout in milliseconds */
  TIMEOUT_MS: 10000,
  /** Latency threshold for YELLOW status (ms) */
  SLOW_LATENCY_MS: 5000,
  /** Weight for degraded (YELLOW) status in availability calculation */
  DEGRADED_WEIGHT: 0.7,
  /** Default success validation string for Claude */
  SUCCESS_CONTAINS_CLAUDE: "pong",
  /** Default success validation string for Codex */
  SUCCESS_CONTAINS_CODEX: "pong",
  /** Default success validation string for OpenAI */
  SUCCESS_CONTAINS_OPENAI: "pong",
  /** Default success validation string for Gemini */
  SUCCESS_CONTAINS_GEMINI: "pong",
} as const;

/**
 * Configuration for provider test execution
 */
export interface ProviderTestConfig {
  /** Provider ID (for existing providers) */
  providerId?: string;
  /** Provider base URL */
  providerUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Provider type determines request format */
  providerType: ProviderType;
  /** Model to test (uses type-specific default if not provided) */
  model?: string;
  /** Proxy URL (optional) */
  proxyUrl?: string;
  /** Whether to fallback to direct if proxy fails */
  proxyFallbackToDirect?: boolean;
  /** Latency threshold in ms (default: 5000) */
  latencyThresholdMs?: number;
  /** String that must be present in response (default: type-specific) */
  successContains?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;

  // =========== Custom Configuration Fields ===========

  /** Preset configuration ID (e.g., 'cc_base', 'cx_base') */
  preset?: string;
  /** Custom JSON payload (overrides preset and default body) */
  customPayload?: string;
  /** Custom headers to merge with default headers */
  customHeaders?: Record<string, string>;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Token usage information from response
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreation5mInputTokens?: number;
  cacheCreation1hInputTokens?: number;
}

/**
 * Validation details for each tier
 */
export interface ValidationDetails {
  /** Tier 1: HTTP status code check passed */
  httpPassed: boolean;
  /** HTTP status code received */
  httpStatusCode?: number;
  /** Tier 2: Latency within threshold */
  latencyPassed: boolean;
  /** Actual latency in ms */
  latencyMs?: number;
  /** Tier 3: Content validation passed */
  contentPassed: boolean;
  /** Content validation target string */
  contentTarget?: string;
}

/**
 * Complete test result
 */
export interface ProviderTestResult {
  /** Overall success (status is green or yellow) */
  success: boolean;
  /** Primary status */
  status: TestStatus;
  /** Detailed sub-status */
  subStatus: TestSubStatus;
  /** Total request latency in ms */
  latencyMs: number;
  /** Time to first byte in ms (if available) */
  firstByteMs?: number;
  /** HTTP status code */
  httpStatusCode?: number;
  /** HTTP status text */
  httpStatusText?: string;
  /** Model used in response */
  model?: string;
  /** Response content preview (truncated to 500 chars) */
  content?: string;
  /** Raw response body for user inspection (truncated to 5000 chars) */
  rawResponse?: string;
  /** Token usage (deprecated - kept for backward compatibility) */
  usage?: TokenUsage;
  /** Stream info (deprecated - kept for backward compatibility) */
  streamInfo?: {
    isStreaming: boolean;
    chunksReceived?: number;
  };
  /** Error message (if failed) */
  errorMessage?: string;
  /** Error type classification */
  errorType?: string;
  /** Raw error object (for debugging) */
  rawError?: unknown;
  /** Test timestamp */
  testedAt: Date;
  /** Detailed validation results */
  validationDetails: ValidationDetails;
  /** Whether proxy was used */
  usedProxy?: boolean;
}

// ============================================================================
// Parser Types
// ============================================================================

/**
 * Parsed response from any provider format
 */
export interface ParsedResponse {
  /** Extracted text content */
  content: string;
  /** Model from response */
  model?: string;
  /** Token usage */
  usage?: TokenUsage;
  /** Whether response was streaming */
  isStreaming: boolean;
  /** Number of chunks (for streaming) */
  chunksReceived?: number;
}

/**
 * Parser function signature
 */
export type ResponseParser = (body: string, contentType?: string) => ParsedResponse;

// ============================================================================
// Test Request Body Types
// ============================================================================

/**
 * Claude Messages API request body
 */
export interface ClaudeTestBody {
  model: string;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  }>;
  system?: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  max_tokens: number;
  stream: boolean;
  metadata?: { user_id: string };
}

/**
 * Codex Response API request body
 */
export interface CodexTestBody {
  model: string;
  instructions: string;
  input: Array<{
    type: "message";
    role: "user";
    content: Array<{ type: "input_text"; text: string }>;
  }>;
  tools: unknown[];
  tool_choice: string;
  reasoning?: { effort: string; summary: string };
  store: boolean;
  stream: boolean;
}

/**
 * OpenAI Chat Completions request body
 */
export interface OpenAITestBody {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  max_tokens: number;
  stream: boolean;
}

/**
 * Gemini GenerateContent request body
 */
export interface GeminiTestBody {
  contents: Array<{
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    maxOutputTokens: number;
  };
}
