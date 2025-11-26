/**
 * SSE Stream Collector
 * Parses Server-Sent Events (SSE) streams and extracts text content
 * Based on relay-pulse extractTextFromSSE implementation
 *
 * Supports multiple formats:
 * - Anthropic: {"delta":{"text":"..."}}
 * - OpenAI: {"choices":[{"delta":{"content":"..."}}]}
 * - Codex Response API: {"output":[{"content":[{"text":"..."}]}]}
 */

import type { TokenUsage, ParsedResponse } from '../types';

/**
 * Extract text content from an SSE stream body
 * Handles both Anthropic and OpenAI streaming formats
 */
export function extractTextFromSSE(body: string): string {
  const lines = body.split('\n');
  const texts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip non-data lines
    if (!trimmed.startsWith('data:')) {
      continue;
    }

    // Extract payload after "data:"
    const payload = trimmed.slice(5).trim();

    // Skip empty or [DONE] markers
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;

      // Anthropic format: {"type":"content_block_delta", "delta":{"type":"text_delta","text":"..."}}
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.text && typeof delta.text === 'string') {
        texts.push(delta.text);
        continue;
      }

      // OpenAI format: {"choices":[{"delta":{"content":"..."}}]}
      const choices = obj.choices as Array<{
        delta?: { content?: string };
      }> | undefined;
      if (choices && Array.isArray(choices)) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          }
        }
        continue;
      }

      // Codex Response API format: {"output":[{"content":[{"text":"..."}]}]}
      const output = obj.output as Array<{
        content?: Array<{ text?: string }>;
      }> | undefined;
      if (output && Array.isArray(output)) {
        for (const item of output) {
          if (item.content && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c.text) {
                texts.push(c.text);
              }
            }
          }
        }
        continue;
      }

      // Generic fallback: top-level content/message fields
      if (obj.content && typeof obj.content === 'string') {
        texts.push(obj.content);
        continue;
      }
      if (obj.message && typeof obj.message === 'string') {
        texts.push(obj.message);
        continue;
      }
      if (obj.text && typeof obj.text === 'string') {
        texts.push(obj.text);
        continue;
      }
    } catch {
      // Not valid JSON, use raw payload (could be error message)
      if (payload.length < 500) {
        texts.push(payload);
      }
    }
  }

  return texts.join('');
}

/**
 * Parse a complete SSE stream into a structured response
 */
export function parseSSEStream(body: string): ParsedResponse {
  const lines = body.split('\n');
  const texts: string[] = [];
  let model: string | undefined;
  let usage: TokenUsage | undefined;
  let chunksReceived = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data:')) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    chunksReceived++;

    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;

      // Extract model from first chunk
      if (!model && obj.model && typeof obj.model === 'string') {
        model = obj.model;
      }

      // Anthropic format
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.text && typeof delta.text === 'string') {
        texts.push(delta.text);
      }

      // OpenAI format
      const choices = obj.choices as Array<{
        delta?: { content?: string };
      }> | undefined;
      if (choices) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          }
        }
      }

      // Codex Response API format
      const output = obj.output as Array<{
        content?: Array<{ text?: string }>;
      }> | undefined;
      if (output) {
        for (const item of output) {
          if (item.content) {
            for (const c of item.content) {
              if (c.text) texts.push(c.text);
            }
          }
        }
      }

      // Extract usage from final chunk (Anthropic message_delta)
      if (obj.type === 'message_delta') {
        const msgUsage = obj.usage as {
          output_tokens?: number;
        } | undefined;
        if (msgUsage?.output_tokens) {
          usage = {
            inputTokens: 0,
            outputTokens: msgUsage.output_tokens,
          };
        }
      }

      // OpenAI usage in final chunk
      const objUsage = obj.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | undefined;
      if (objUsage) {
        usage = {
          inputTokens: objUsage.prompt_tokens || 0,
          outputTokens: objUsage.completion_tokens || 0,
        };
      }
    } catch {
      // Skip invalid JSON chunks
    }
  }

  return {
    content: texts.join(''),
    model,
    usage,
    isStreaming: true,
    chunksReceived,
  };
}

/**
 * Check if a response body appears to be an SSE stream
 */
export function isSSEResponse(body: string, contentType?: string): boolean {
  // Check Content-Type header
  if (
    contentType?.includes('text/event-stream') ||
    contentType?.includes('text/x-event-stream')
  ) {
    return true;
  }

  // Check body pattern (multiple data: lines)
  const dataLineCount = (body.match(/^data:/gm) || []).length;
  return dataLineCount > 1;
}

/**
 * Parse NDJSON stream (newline-delimited JSON)
 * Used by some streaming APIs
 */
export function parseNDJSONStream(body: string): ParsedResponse {
  const lines = body.split('\n').filter((l) => l.trim());
  const texts: string[] = [];
  let model: string | undefined;
  let usage: TokenUsage | undefined;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;

      // Extract model
      if (!model && obj.model && typeof obj.model === 'string') {
        model = obj.model;
      }

      // Extract content from various formats
      const choices = obj.choices as Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }> | undefined;
      if (choices) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          } else if (choice.message?.content) {
            texts.push(choice.message.content);
          }
        }
      }

      // Extract usage
      const objUsage = obj.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
      } | undefined;
      if (objUsage) {
        usage = {
          inputTokens: objUsage.prompt_tokens || 0,
          outputTokens: objUsage.completion_tokens || 0,
        };
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return {
    content: texts.join(''),
    model,
    usage,
    isStreaming: true,
    chunksReceived: lines.length,
  };
}
