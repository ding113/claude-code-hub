/**
 * Response Parsers Index
 * Provides unified parser selection based on provider type
 */

import type { ProviderType } from "@/types/provider";
import type { ParsedResponse } from "../types";
import { parseAnthropicResponse } from "./anthropic-parser";
import { parseCodexResponse } from "./codex-parser";
import { parseGeminiResponse } from "./gemini-parser";
import { parseOpenAIResponse } from "./openai-parser";

export { parseAnthropicResponse } from "./anthropic-parser";
export { parseCodexResponse } from "./codex-parser";
export { parseGeminiResponse } from "./gemini-parser";
export { parseOpenAIResponse } from "./openai-parser";

/**
 * Parser function type
 */
export type ResponseParser = (body: string, contentType?: string) => ParsedResponse;

/**
 * Parser registry by provider type
 */
const parserRegistry: Record<ProviderType, ResponseParser> = {
  claude: parseAnthropicResponse,
  "claude-auth": parseAnthropicResponse,
  codex: parseCodexResponse,
  "openai-compatible": parseOpenAIResponse,
  gemini: parseGeminiResponse,
  "gemini-cli": parseGeminiResponse,
};

/**
 * Get the appropriate parser for a provider type
 */
export function getParser(providerType: ProviderType): ResponseParser {
  const parser = parserRegistry[providerType];
  if (!parser) {
    throw new Error(`No parser available for provider type: ${providerType}`);
  }
  return parser;
}

/**
 * Parse response using the appropriate parser for the provider type
 */
export function parseResponse(
  providerType: ProviderType,
  body: string,
  contentType?: string
): ParsedResponse {
  const parser = getParser(providerType);
  return parser(body, contentType);
}
