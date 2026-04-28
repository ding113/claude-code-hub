import type { ProtocolFamily } from "./response-validator";

export interface NonStreamEmitInput {
  family: ProtocolFamily;
  finalBody: string;
}

export interface StreamEmitInput {
  family: ProtocolFamily;
  finalBody: string;
}

export interface StreamErrorEmitInput {
  family: ProtocolFamily;
  errorMessage: string;
  errorCode?: string;
}

/**
 * Non-stream emitter is a passthrough: the validator already guaranteed the
 * body is non-empty and protocol-compatible, so the orchestrator simply forwards
 * the upstream body bytes verbatim.
 */
export function emitFinalNonStream(input: NonStreamEmitInput): string {
  return input.finalBody;
}

/**
 * Stream emitter. Given a fully buffered, validated upstream JSON body, return
 * a protocol-compatible SSE byte string that downstream clients can decode as
 * if it were a regular streaming response.
 */
export function emitFinalStream(input: StreamEmitInput): string {
  const parsed = parseJsonOrThrow(input.finalBody);
  switch (input.family) {
    case "anthropic":
      return emitAnthropicStream(parsed);
    case "openai-chat":
      return emitOpenAIChatStream(parsed);
    case "openai-responses":
      return emitOpenAIResponsesStream(parsed);
    case "gemini":
      return emitGeminiStream(parsed, input.finalBody);
  }
}

/**
 * Stream error emitter. Used after heartbeats have already been sent and the
 * orchestrator decides every upstream attempt failed. The output must be
 * protocol-compatible, must NOT contain a success terminator, and is the
 * caller's responsibility to flush before closing the response stream.
 */
export function emitStreamError(input: StreamErrorEmitInput): string {
  const code = input.errorCode ?? "upstream_failure";
  switch (input.family) {
    case "anthropic":
      return formatSseEvent("error", {
        type: "error",
        error: { type: code, message: input.errorMessage },
      });
    case "openai-chat":
      return formatSseData({
        error: { code, message: input.errorMessage },
      });
    case "openai-responses":
      return formatSseEvent("response.error", {
        type: "response.error",
        error: { code, message: input.errorMessage },
      });
    case "gemini":
      return formatSseData({
        error: { code, message: input.errorMessage, status: code },
      });
  }
}

interface AnthropicMessage {
  id?: unknown;
  type?: unknown;
  role?: unknown;
  model?: unknown;
  content?: unknown;
  stop_reason?: unknown;
  stop_sequence?: unknown;
  usage?: unknown;
}

function emitAnthropicStream(parsed: unknown): string {
  const msg = (parsed ?? {}) as AnthropicMessage;
  const blocks = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
  const baseMessage = {
    id: msg.id ?? "msg_fake_streaming",
    type: "message",
    role: msg.role ?? "assistant",
    model: msg.model ?? null,
    content: [] as unknown[],
    stop_reason: null,
    stop_sequence: null,
    usage: msg.usage ?? null,
  };

  const parts: string[] = [];
  parts.push(formatSseEvent("message_start", { type: "message_start", message: baseMessage }));

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      parts.push(
        formatSseEvent("content_block_start", {
          type: "content_block_start",
          index: i,
          content_block: { type: "text", text: "" },
        })
      );
      parts.push(
        formatSseEvent("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: typed.text },
        })
      );
      parts.push(formatSseEvent("content_block_stop", { type: "content_block_stop", index: i }));
      continue;
    }
    // Non-text block: emit content_block_start with the full block, then stop.
    parts.push(
      formatSseEvent("content_block_start", {
        type: "content_block_start",
        index: i,
        content_block: block,
      })
    );
    parts.push(formatSseEvent("content_block_stop", { type: "content_block_stop", index: i }));
  }

  parts.push(
    formatSseEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: msg.stop_reason ?? null,
        stop_sequence: msg.stop_sequence ?? null,
      },
      usage: msg.usage ?? undefined,
    })
  );
  parts.push(formatSseEvent("message_stop", { type: "message_stop" }));
  return parts.join("");
}

interface ChatChoice {
  index?: unknown;
  message?: unknown;
  finish_reason?: unknown;
  logprobs?: unknown;
}

interface ChatCompletion {
  id?: unknown;
  object?: unknown;
  created?: unknown;
  model?: unknown;
  choices?: unknown;
  usage?: unknown;
  system_fingerprint?: unknown;
}

function emitOpenAIChatStream(parsed: unknown): string {
  const completion = (parsed ?? {}) as ChatCompletion;
  const choices = Array.isArray(completion.choices) ? (completion.choices as ChatChoice[]) : [];
  const baseChunk = {
    id: completion.id ?? "chatcmpl_fake_streaming",
    object: "chat.completion.chunk",
    created: completion.created ?? Math.floor(Date.now() / 1000),
    model: completion.model ?? null,
    system_fingerprint: completion.system_fingerprint ?? null,
  };

  const parts: string[] = [];

  // First, emit a "role" delta chunk per choice — initialises the assistant turn.
  parts.push(
    formatSseData({
      ...baseChunk,
      choices: choices.map((choice, index) => ({
        index: typeof choice.index === "number" ? choice.index : index,
        delta: { role: messageRole(choice.message) ?? "assistant" },
        finish_reason: null,
        logprobs: null,
      })),
    })
  );

  // Then emit content / tool_calls deltas. We bundle each choice's full content
  // into one chunk to minimise SSE noise; downstream clients accept a single
  // delta the same as multiple smaller ones.
  parts.push(
    formatSseData({
      ...baseChunk,
      choices: choices.map((choice, index) => {
        const message = (choice.message ?? {}) as Record<string, unknown>;
        const delta: Record<string, unknown> = {};
        if (typeof message.content === "string") {
          delta.content = message.content;
        } else if (Array.isArray(message.content)) {
          delta.content = message.content;
        }
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          delta.tool_calls = message.tool_calls;
        }
        if (message.function_call && typeof message.function_call === "object") {
          delta.function_call = message.function_call;
        }
        return {
          index: typeof choice.index === "number" ? choice.index : index,
          delta,
          finish_reason: null,
          logprobs: choice.logprobs ?? null,
        };
      }),
    })
  );

  // Finish reason chunk per choice.
  parts.push(
    formatSseData({
      ...baseChunk,
      choices: choices.map((choice, index) => ({
        index: typeof choice.index === "number" ? choice.index : index,
        delta: {},
        finish_reason: choice.finish_reason ?? "stop",
        logprobs: null,
      })),
      usage: completion.usage ?? undefined,
    })
  );

  parts.push(formatRawSse("data: [DONE]\n\n"));
  return parts.join("");
}

function messageRole(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

interface OpenAIResponsesEnvelope {
  id?: unknown;
  object?: unknown;
  output?: unknown;
}

function emitOpenAIResponsesStream(parsed: unknown): string {
  const envelope = (parsed ?? {}) as OpenAIResponsesEnvelope;
  const parts: string[] = [];

  // response.created mirrors the final response shape but with empty output for
  // clients that build state incrementally.
  const createdResponse = { ...((parsed as object) ?? {}), output: [] };
  parts.push(
    formatSseEvent("response.created", { type: "response.created", response: createdResponse })
  );

  const output = Array.isArray(envelope.output) ? (envelope.output as unknown[]) : [];
  for (let i = 0; i < output.length; i += 1) {
    const item = output[i];
    parts.push(
      formatSseEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: i,
        item,
      })
    );

    if (item && typeof item === "object" && (item as { type?: unknown }).type === "message") {
      const content = ((item as { content?: unknown }).content as unknown[]) ?? [];
      for (let p = 0; p < content.length; p += 1) {
        const part = content[p];
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "output_text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          const text = (part as { text: string }).text;
          parts.push(
            formatSseEvent("response.output_text.delta", {
              type: "response.output_text.delta",
              output_index: i,
              content_index: p,
              delta: text,
            })
          );
          parts.push(
            formatSseEvent("response.output_text.done", {
              type: "response.output_text.done",
              output_index: i,
              content_index: p,
              text,
            })
          );
        }
      }
    }

    parts.push(
      formatSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: i,
        item,
      })
    );
  }

  parts.push(
    formatSseEvent("response.completed", { type: "response.completed", response: parsed })
  );
  return parts.join("");
}

function emitGeminiStream(_parsed: unknown, finalBody: string): string {
  // Gemini stream framing is `data: <full JSON>\n\n` per response candidate
  // bundle. Since the upstream validation guaranteed the body is a complete
  // candidates payload, emit the whole thing as a single SSE event.
  // Re-stringifying through JSON.parse/stringify would lose key ordering /
  // numerical precision; just trim and emit the original bytes.
  return formatRawSse(`data: ${finalBody.trim()}\n\n`);
}

function formatSseEvent(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function formatSseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatRawSse(text: string): string {
  return text;
}

function parseJsonOrThrow(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `fake streaming emitter received invalid JSON body (${(error as Error).message})`
    );
  }
}
