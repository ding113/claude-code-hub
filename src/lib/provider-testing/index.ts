/**
 * Provider Testing Service
 * Unified provider testing with three-tier validation
 *
 * Based on relay-pulse implementation patterns:
 * https://github.com/prehisle/relay-pulse
 */

// Main test service
export { executeProviderTest, getStatusWeight } from "./test-service";

// Types
export type {
  TestStatus,
  TestSubStatus,
  StatusValue,
  ProviderTestConfig,
  ProviderTestResult,
  TokenUsage,
  ValidationDetails,
  ParsedResponse,
  ClaudeTestBody,
  CodexTestBody,
  OpenAITestBody,
  GeminiTestBody,
} from "./types";

export { TEST_DEFAULTS, STATUS_VALUES } from "./types";

// Validators
export {
  classifyHttpStatus,
  isHttpSuccess,
  getSubStatusDescription,
  evaluateContentValidation,
  extractTextContent,
} from "./validators";

// Parsers
export {
  parseResponse,
  getParser,
  parseAnthropicResponse,
  parseOpenAIResponse,
  parseCodexResponse,
  parseGeminiResponse,
} from "./parsers";

// Utils
export {
  getTestBody,
  getTestHeaders,
  getTestUrl,
  DEFAULT_MODELS,
  DEFAULT_SUCCESS_CONTAINS,
  API_ENDPOINTS,
  extractTextFromSSE,
  parseSSEStream,
  isSSEResponse,
  parseNDJSONStream,
  aggregateResponseText,
} from "./utils";
