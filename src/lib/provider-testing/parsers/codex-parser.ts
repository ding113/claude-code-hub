/**
 * Codex Response API Parser
 * Handles streaming and non-streaming responses for /v1/responses endpoint
 */

import type { ParsedResponse, TokenUsage } from "../types";
import { isSSEResponse, parseNDJSONStream, parseSSEStream } from "../utils/sse-collector";

/**
 * Codex Response API response structure
 */
interface CodexResponse {
  id?: string;
  object?: string;
  created_at?: number;
  model?: string;
  output?: Array<{
    type?: string;
    id?: string;
    status?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: unknown[];
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Check if response is NDJSON format
 * Codex often uses NDJSON instead of SSE
 */
function isNDJSONResponse(body: string, contentType?: string): boolean {
  if (contentType?.includes("application/x-ndjson")) {
    return true;
  }

  // Check if body has multiple JSON objects on separate lines
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length > 1) {
    try {
      // Try to parse first two lines as JSON
      JSON.parse(lines[0]);
      JSON.parse(lines[1]);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Parse Codex Response API response
 */
export function parseCodexResponse(body: string, contentType?: string): ParsedResponse {
  // Check if streaming SSE response
  if (isSSEResponse(body, contentType)) {
    return parseSSEStream(body);
  }

  // Check if NDJSON streaming response
  if (isNDJSONResponse(body, contentType)) {
    return parseNDJSONStream(body);
  }

  // Parse non-streaming JSON response
  try {
    const data = JSON.parse(body) as CodexResponse;

    // Handle error response
    if (data.error) {
      return {
        content: data.error.message || "Unknown error",
        model: undefined,
        usage: undefined,
        isStreaming: false,
      };
    }

    // Extract text content from output array
    const texts: string[] = [];
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && c.text) {
              texts.push(c.text);
            } else if (c.text) {
              texts.push(c.text);
            }
          }
        }
      }
    }

    const content = texts.join("");

    // Extract usage
    let usage: TokenUsage | undefined;
    if (data.usage) {
      usage = {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
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
