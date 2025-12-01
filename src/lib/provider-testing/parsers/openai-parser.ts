/**
 * OpenAI Chat Completions API Response Parser
 * Handles both streaming and non-streaming responses
 */

import type { ParsedResponse, TokenUsage } from "../types";
import { isSSEResponse, parseSSEStream } from "../utils/sse-collector";

/**
 * OpenAI non-streaming response structure
 */
interface OpenAIResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Parse OpenAI Chat Completions API response
 */
export function parseOpenAIResponse(body: string, contentType?: string): ParsedResponse {
  // Check if streaming response
  if (isSSEResponse(body, contentType)) {
    return parseSSEStream(body);
  }

  // Parse non-streaming JSON response
  try {
    const data = JSON.parse(body) as OpenAIResponse;

    // Handle error response
    if (data.error) {
      return {
        content: data.error.message || "Unknown error",
        model: undefined,
        usage: undefined,
        isStreaming: false,
      };
    }

    // Extract text content from choices
    const content =
      data.choices
        ?.map((c) => c.message?.content || "")
        .filter(Boolean)
        .join("") || "";

    // Extract usage
    let usage: TokenUsage | undefined;
    if (data.usage) {
      usage = {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      };
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
