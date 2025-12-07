/**
 * Anthropic Messages API Response Parser
 * Handles both streaming and non-streaming responses
 */

import type { ParsedResponse, TokenUsage } from "../types";
import { isSSEResponse, parseSSEStream } from "../utils/sse-collector";

/**
 * Anthropic non-streaming response structure
 */
interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: Array<{
    type: string;
    text?: string;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  error?: {
    type?: string;
    message?: string;
  };
}

/**
 * Parse Anthropic Messages API response
 */
export function parseAnthropicResponse(body: string, contentType?: string): ParsedResponse {
  // Check if streaming response
  if (isSSEResponse(body, contentType)) {
    return parseSSEStream(body);
  }

  // Parse non-streaming JSON response
  try {
    const data = JSON.parse(body) as AnthropicResponse;

    // Handle error response
    if (data.error) {
      return {
        content: data.error.message || "Unknown error",
        model: undefined,
        usage: undefined,
        isStreaming: false,
      };
    }

    // Extract text content
    const textParts = data.content?.filter((c) => c.type === "text").map((c) => c.text || "") || [];

    const content = textParts.join("");

    // Extract usage
    let usage: TokenUsage | undefined;
    if (data.usage) {
      usage = {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        cacheCreationInputTokens: data.usage.cache_creation_input_tokens,
        cacheReadInputTokens: data.usage.cache_read_input_tokens,
        cacheCreation5mInputTokens: data.usage.cache_creation?.ephemeral_5m_input_tokens,
        cacheCreation1hInputTokens: data.usage.cache_creation?.ephemeral_1h_input_tokens,
      };

      if (
        usage.cacheCreationInputTokens === undefined &&
        (usage.cacheCreation5mInputTokens || usage.cacheCreation1hInputTokens)
      ) {
        usage.cacheCreationInputTokens =
          (usage.cacheCreation5mInputTokens || 0) + (usage.cacheCreation1hInputTokens || 0);
      }
    }

    return {
      content,
      model: data.model,
      usage,
      isStreaming: false,
    };
  } catch {
    // Return raw body if JSON parsing fails
    return {
      content: body.slice(0, 500),
      model: undefined,
      usage: undefined,
      isStreaming: false,
    };
  }
}
