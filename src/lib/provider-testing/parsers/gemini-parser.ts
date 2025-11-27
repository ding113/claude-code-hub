/**
 * Gemini GenerateContent API Response Parser
 * Handles non-streaming responses (Gemini uses different endpoint for streaming)
 */

import type { ParsedResponse, TokenUsage } from "../types";

/**
 * Gemini GenerateContent response structure
 */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
      role?: string;
    };
    finishReason?: string;
    index?: number;
    safetyRatings?: Array<{
      category?: string;
      probability?: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/**
 * Parse Gemini GenerateContent API response
 */
export function parseGeminiResponse(body: string, _contentType?: string): ParsedResponse {
  try {
    const data = JSON.parse(body) as GeminiResponse;

    // Handle error response
    if (data.error) {
      return {
        content: data.error.message || "Unknown error",
        model: undefined,
        usage: undefined,
        isStreaming: false,
      };
    }

    // Extract text content from candidates
    const texts: string[] = [];
    if (data.candidates && Array.isArray(data.candidates)) {
      for (const candidate of data.candidates) {
        if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              texts.push(part.text);
            }
          }
        }
      }
    }

    const content = texts.join("");

    // Extract usage
    let usage: TokenUsage | undefined;
    if (data.usageMetadata) {
      usage = {
        inputTokens: data.usageMetadata.promptTokenCount || 0,
        outputTokens: data.usageMetadata.candidatesTokenCount || 0,
      };
    }

    return {
      content,
      model: data.modelVersion,
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
