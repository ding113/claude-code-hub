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

import type { ParsedResponse, TokenUsage } from "../types";

/**
 * Extract text content from an SSE stream body
 * Handles both Anthropic and OpenAI streaming formats
 */
export function extractTextFromSSE(body: string): string {
  const lines = body.split("\n");
  const texts: string[] = [];
  const fallbackTexts: string[] = [];
  let fallbackPriority = Number.POSITIVE_INFINITY;

  const assignFallback = (priority: number, nextTexts: string[]) => {
    if (nextTexts.length === 0 || fallbackPriority < priority) {
      return;
    }
    fallbackPriority = priority;
    fallbackTexts.length = 0;
    fallbackTexts.push(...nextTexts);
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip non-data lines
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    // Extract payload after "data:"
    const payload = trimmed.slice(5).trim();

    // Skip empty or [DONE] markers
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const eventType = obj.type;

      // Anthropic format: {"type":"content_block_delta", "delta":{"type":"text_delta","text":"..."}}
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.text && typeof delta.text === "string") {
        texts.push(delta.text);
        continue;
      }

      // Codex Responses SSE format: {"type":"response.output_text.delta","delta":"..."}
      if (eventType === "response.output_text.delta" && typeof obj.delta === "string") {
        texts.push(obj.delta);
        continue;
      }

      if (eventType === "response.output_text.done" && typeof obj.text === "string") {
        assignFallback(1, [obj.text]);
        continue;
      }

      const part = obj.part as Record<string, unknown> | undefined;
      if (eventType === "response.content_part.done" && typeof part?.text === "string") {
        assignFallback(2, [part.text]);
        continue;
      }

      const item = obj.item as
        | {
            content?: Array<{ text?: string }>;
          }
        | undefined;
      if (eventType === "response.output_item.done" && item?.content) {
        assignFallback(
          3,
          item.content.map((contentItem) => contentItem.text || "").filter(Boolean)
        );
        continue;
      }

      const response = obj.response as
        | {
            output?: Array<{
              content?: Array<{ text?: string }>;
            }>;
          }
        | undefined;
      if (eventType === "response.completed" && response?.output) {
        assignFallback(
          4,
          response.output.flatMap(
            (outputItem) => outputItem.content?.map((contentItem) => contentItem.text || "") || []
          )
        );
        continue;
      }

      // OpenAI format: {"choices":[{"delta":{"content":"..."}}]}
      const choices = obj.choices as
        | Array<{
            delta?: { content?: string };
          }>
        | undefined;
      if (choices && Array.isArray(choices)) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          }
        }
        continue;
      }

      // Codex Response API format: {"output":[{"content":[{"text":"..."}]}]}
      const output = obj.output as
        | Array<{
            content?: Array<{ text?: string }>;
          }>
        | undefined;
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
      if (obj.content && typeof obj.content === "string") {
        texts.push(obj.content);
        continue;
      }
      if (obj.message && typeof obj.message === "string") {
        texts.push(obj.message);
        continue;
      }
      if (obj.text && typeof obj.text === "string") {
        texts.push(obj.text);
      }
    } catch {
      // Not valid JSON, use raw payload (could be error message)
      if (payload.length < 500) {
        texts.push(payload);
      }
    }
  }

  return texts.length > 0 ? texts.join("") : fallbackTexts.join("");
}

/**
 * Parse a complete SSE stream into a structured response
 */

/**
 * True when a partial/full SSE buffer contains a real content token (text delta).
 * Ignores SSE control frames like response.created / message_start / pings,
 * so first-token timing is not "fake-fast" on empty control events.
 */
export function hasRealContentTokenInSse(buffer: string): boolean {
  if (!buffer) return false;

  // Fast path: if extractTextFromSSE already finds non-empty text, we're done.
  // (It also handles done/completed fallbacks; good enough for timing.)
  try {
    if (extractTextFromSSE(buffer).trim().length > 0) {
      return true;
    }
  } catch {
    // fall through to line scan
  }

  // Incremental scan of data: lines for delta content only.
  const lines = buffer.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const eventType = obj.type;

      // Anthropic text delta
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (typeof delta?.text === "string" && delta.text.length > 0) return true;

      // Codex / Responses text delta
      if (eventType === "response.output_text.delta" && typeof obj.delta === "string" && obj.delta.length > 0) {
        return true;
      }

      // OpenAI chat completions stream
      const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          if (typeof choice.delta?.content === "string" && choice.delta.content.length > 0) {
            return true;
          }
        }
      }
    } catch {
      // non-json data line — ignore for token detection
    }
  }
  return false;
}

/**
 * True when a non-stream JSON/plain body already contains usable content text.
 */
export function hasRealContentTokenInBody(body: string, contentType?: string): boolean {
  if (!body?.trim()) return false;
  if (isSSEResponse(body, contentType) || body.includes("data:")) {
    return hasRealContentTokenInSse(body);
  }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    // Anthropic non-stream
    const content = obj.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c.text === "string" && c.text.trim().length > 0) return true;
      }
    }
    // OpenAI chat
    const choices = obj.choices as Array<{ message?: { content?: string } }> | undefined;
    if (Array.isArray(choices)) {
      for (const c of choices) {
        if (typeof c.message?.content === "string" && c.message.content.trim().length > 0) {
          return true;
        }
      }
    }
    // Responses API
    const output = obj.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
    if (Array.isArray(output)) {
      for (const item of output) {
        for (const c of item.content ?? []) {
          if (typeof c.text === "string" && c.text.trim().length > 0) return true;
        }
      }
    }
  } catch {
    // plain text body
    return body.trim().length > 0;
  }
  return false;
}

export function parseSSEStream(body: string): ParsedResponse {
  const lines = body.split("\n");
  const texts: string[] = [];
  const fallbackTexts: string[] = [];
  let fallbackPriority = Number.POSITIVE_INFINITY;
  let model: string | undefined;
  let usage: TokenUsage | undefined;
  let chunksReceived = 0;

  const assignFallback = (priority: number, nextTexts: string[]) => {
    if (nextTexts.length === 0 || fallbackPriority < priority) {
      return;
    }
    fallbackPriority = priority;
    fallbackTexts.length = 0;
    fallbackTexts.push(...nextTexts);
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    chunksReceived++;

    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const eventType = obj.type;
      const response = obj.response as Record<string, unknown> | undefined;

      // Extract model from first chunk
      if (!model && obj.model && typeof obj.model === "string") {
        model = obj.model;
      }
      if (!model && response?.model && typeof response.model === "string") {
        model = response.model;
      }

      // Anthropic format
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.text && typeof delta.text === "string") {
        texts.push(delta.text);
      }

      // Codex Responses SSE format
      if (eventType === "response.output_text.delta" && typeof obj.delta === "string") {
        texts.push(obj.delta);
      }

      if (eventType === "response.output_text.done" && typeof obj.text === "string") {
        assignFallback(1, [obj.text]);
      }

      const part = obj.part as Record<string, unknown> | undefined;
      if (eventType === "response.content_part.done" && typeof part?.text === "string") {
        assignFallback(2, [part.text]);
      }

      const item = obj.item as
        | {
            content?: Array<{ text?: string }>;
          }
        | undefined;
      if (eventType === "response.output_item.done" && item?.content) {
        assignFallback(
          3,
          item.content.map((contentItem) => contentItem.text || "").filter(Boolean)
        );
      }

      const responseOutput = response?.output as
        | Array<{
            content?: Array<{ text?: string }>;
          }>
        | undefined;
      if (eventType === "response.completed" && responseOutput) {
        assignFallback(
          4,
          responseOutput.flatMap(
            (outputItem) => outputItem.content?.map((contentItem) => contentItem.text || "") || []
          )
        );
      }

      // OpenAI format
      const choices = obj.choices as
        | Array<{
            delta?: { content?: string };
          }>
        | undefined;
      if (choices) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          }
        }
      }

      // Codex Response API format
      const output = obj.output as
        | Array<{
            content?: Array<{ text?: string }>;
          }>
        | undefined;
      if (output) {
        for (const item of output) {
          if (item.content) {
            for (const c of item.content) {
              if (c.text) texts.push(c.text);
            }
          }
        }
      }

      // Extract usage from final chunk (Anthropic message_start / message_delta).
      // message_start carries input_tokens; message_delta carries final output_tokens.
      // Must NOT be overwritten by the OpenAI prompt_tokens/completion_tokens branch below.
      if (obj.type === "message_start") {
        const message = obj.message as
          | {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            }
          | undefined;
        const startUsage = message?.usage;
        if (startUsage) {
          usage = {
            inputTokens: startUsage.input_tokens || 0,
            outputTokens: startUsage.output_tokens || 0,
            cacheCreationInputTokens: startUsage.cache_creation_input_tokens,
            cacheReadInputTokens: startUsage.cache_read_input_tokens,
          };
        }
      }

      if (obj.type === "message_delta") {
        const msgUsage = obj.usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            }
          | undefined;
        if (msgUsage) {
          usage = {
            // Prefer delta values; fall back to earlier message_start input tokens.
            inputTokens:
              typeof msgUsage.input_tokens === "number"
                ? msgUsage.input_tokens
                : (usage?.inputTokens ?? 0),
            outputTokens:
              typeof msgUsage.output_tokens === "number"
                ? msgUsage.output_tokens
                : (usage?.outputTokens ?? 0),
            cacheCreationInputTokens:
              msgUsage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
            cacheReadInputTokens: msgUsage.cache_read_input_tokens ?? usage?.cacheReadInputTokens,
          };
        }
      }

      // OpenAI chat.completions stream usage (prompt_tokens / completion_tokens).
      // Only apply when those fields exist — Anthropic uses input_tokens/output_tokens
      // and must not be zeroed out by this branch.
      const objUsage = obj.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            input_tokens_details?: { cached_tokens?: number };
          }
        | undefined;
      if (objUsage && (objUsage.prompt_tokens != null || objUsage.completion_tokens != null)) {
        usage = {
          inputTokens: objUsage.prompt_tokens || 0,
          outputTokens: objUsage.completion_tokens || 0,
          cacheCreationInputTokens:
            objUsage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
          cacheReadInputTokens:
            objUsage.prompt_tokens_details?.cached_tokens ??
            objUsage.cache_read_input_tokens ??
            objUsage.input_tokens_details?.cached_tokens ??
            usage?.cacheReadInputTokens,
        };
      } else if (
        objUsage &&
        obj.type !== "message_delta" &&
        obj.type !== "message_start" &&
        (objUsage.input_tokens != null || objUsage.output_tokens != null)
      ) {
        // Generic top-level usage with Anthropic/Responses field names (non-message events).
        usage = {
          inputTokens: objUsage.input_tokens || 0,
          outputTokens: objUsage.output_tokens || 0,
          cacheCreationInputTokens:
            objUsage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
          cacheReadInputTokens:
            objUsage.cache_read_input_tokens ??
            objUsage.input_tokens_details?.cached_tokens ??
            usage?.cacheReadInputTokens,
        };
      }

      const responseUsage = response?.usage as
        | {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
          }
        | undefined;
      if (responseUsage && (responseUsage.input_tokens != null || responseUsage.output_tokens != null)) {
        usage = {
          inputTokens: responseUsage.input_tokens || 0,
          outputTokens: responseUsage.output_tokens || 0,
          cacheCreationInputTokens:
            responseUsage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
          cacheReadInputTokens:
            responseUsage.cache_read_input_tokens ??
            responseUsage.input_tokens_details?.cached_tokens ??
            usage?.cacheReadInputTokens,
        };
      }
    } catch {
      // Skip invalid JSON chunks
    }
  }

  return {
    content: texts.length > 0 ? texts.join("") : fallbackTexts.join(""),
    model,
    usage,
    isStreaming: true,
    chunksReceived,
  };
}

/**
 * Check if a response body appears to be an SSE stream
 * Based on relay-pulse heuristic: check for both "event:" and "data:" patterns
 */
export function isSSEResponse(body: string, contentType?: string): boolean {
  // Check Content-Type header
  if (contentType?.includes("text/event-stream") || contentType?.includes("text/x-event-stream")) {
    return true;
  }

  // Heuristic from relay-pulse: must contain both "event:" and "data:" patterns
  // This is more accurate than just counting data: lines
  const hasEventLines = body.includes("event:");
  const hasDataLines = body.includes("data:");

  return hasEventLines && hasDataLines;
}

/**
 * Aggregate response text from various formats (SSE, JSON, plain text)
 * Based on relay-pulse aggregateResponseText function
 *
 * This function attempts to extract text content from:
 * 1. SSE/streaming responses - parse data: lines and extract deltas
 * 2. JSON responses - parse and extract content fields
 * 3. Plain text - return as-is
 *
 * Key feature: Falls back to raw body if SSE parsing fails
 */
export function aggregateResponseText(body: string, _contentType?: string): string {
  if (!body?.trim()) {
    return "";
  }

  // Try SSE parsing if it looks like SSE (same heuristic as relay-pulse)
  if (body.includes("event:") && body.includes("data:")) {
    const sseText = extractTextFromSSE(body);
    if (sseText?.trim()) {
      return sseText;
    }
    // Fall through to other methods if SSE extraction returned empty
  }

  // Try JSON parsing for common response formats
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;

    // Anthropic format: {"content":[{"type":"text","text":"..."}]}
    if (obj.content && Array.isArray(obj.content)) {
      const texts = (obj.content as Array<{ type?: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text || "");
      if (texts.length > 0) {
        return texts.join("");
      }
    }

    // OpenAI format: {"choices":[{"message":{"content":"..."}}]}
    if (obj.choices && Array.isArray(obj.choices)) {
      const texts = (obj.choices as Array<{ message?: { content?: string }; text?: string }>)
        .map((c) => c.message?.content || c.text || "")
        .filter(Boolean);
      if (texts.length > 0) {
        return texts.join("");
      }
    }

    // Codex Response API format: {"output":[{"content":[{"text":"..."}]}]}
    if (obj.output && Array.isArray(obj.output)) {
      const texts = (obj.output as Array<{ content?: Array<{ text?: string }> }>).flatMap(
        (o) => o.content?.map((c) => c.text || "").filter(Boolean) || []
      );
      if (texts.length > 0) {
        return texts.join("");
      }
    }

    // Gemini format: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
    if (obj.candidates && Array.isArray(obj.candidates)) {
      const texts = (
        obj.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>
      ).flatMap((c) => c.content?.parts?.map((p) => p.text || "").filter(Boolean) || []);
      if (texts.length > 0) {
        return texts.join("");
      }
    }

    // Direct content/text/message fields
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.message === "string") return obj.message;

    // Error message extraction
    if (obj.error && typeof obj.error === "object") {
      const error = obj.error as { message?: string };
      if (error.message) return error.message;
    }
  } catch {
    // Not JSON, continue to raw body fallback
  }

  // Fallback: return raw body
  return body;
}

/**
 * Parse NDJSON stream (newline-delimited JSON)
 * Used by some streaming APIs
 */
export function parseNDJSONStream(body: string): ParsedResponse {
  const lines = body.split("\n").filter((l) => l.trim());
  const texts: string[] = [];
  let model: string | undefined;
  let usage: TokenUsage | undefined;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;

      // Extract model
      if (!model && obj.model && typeof obj.model === "string") {
        model = obj.model;
      }

      // Extract content from various formats
      const choices = obj.choices as
        | Array<{
            delta?: { content?: string };
            message?: { content?: string };
          }>
        | undefined;
      if (choices) {
        for (const choice of choices) {
          if (choice.delta?.content) {
            texts.push(choice.delta.content);
          } else if (choice.message?.content) {
            texts.push(choice.message.content);
          }
        }
      }

      // Extract usage (OpenAI chat fields and Responses/Codex fields)
      const objUsage = obj.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            input_tokens_details?: { cached_tokens?: number };
          }
        | undefined;
      if (objUsage) {
        const input =
          objUsage.prompt_tokens != null
            ? objUsage.prompt_tokens
            : objUsage.input_tokens != null
              ? objUsage.input_tokens
              : undefined;
        const output =
          objUsage.completion_tokens != null
            ? objUsage.completion_tokens
            : objUsage.output_tokens != null
              ? objUsage.output_tokens
              : undefined;
        if (input != null || output != null) {
          usage = {
            inputTokens: input || 0,
            outputTokens: output || 0,
            cacheCreationInputTokens:
              objUsage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
            cacheReadInputTokens:
              objUsage.prompt_tokens_details?.cached_tokens ??
              objUsage.cache_read_input_tokens ??
              objUsage.input_tokens_details?.cached_tokens ??
              usage?.cacheReadInputTokens,
          };
        }
      }

      // Nested response.usage (Responses API NDJSON)
      const response = obj.response as
        | {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
              input_tokens_details?: { cached_tokens?: number };
            };
            model?: string;
          }
        | undefined;
      if (!model && response?.model && typeof response.model === "string") {
        model = response.model;
      }
      if (response?.usage) {
        usage = {
          inputTokens: response.usage.input_tokens || 0,
          outputTokens: response.usage.output_tokens || 0,
          cacheCreationInputTokens:
            response.usage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens,
          cacheReadInputTokens:
            response.usage.cache_read_input_tokens ??
            response.usage.input_tokens_details?.cached_tokens ??
            usage?.cacheReadInputTokens,
        };
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return {
    content: texts.join(""),
    model,
    usage,
    isStreaming: true,
    chunksReceived: lines.length,
  };
}
