import type { Hono } from "hono";
import { stream } from "hono/streaming";
import type { TestScenario } from "../config/scenarios";
import { createUsage, estimateInputTokens, generateOutputText } from "../generators/response";
import { formatSSE, streamTextChunks } from "../generators/streaming";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.floor(num));
}

export function registerClaudeRoutes(app: Hono): void {
  app.post("/v1/messages", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          error: {
            message: "Invalid JSON body",
            type: "invalid_request_error",
            code: "invalid_json",
          },
        },
        400
      );
    }

    const model = typeof body.model === "string" ? body.model : "claude-mock";
    const isStream = body.stream === true;
    const inputTokens = estimateInputTokens(body.messages);
    const outputTokens = parsePositiveInt(body.max_tokens, 128);

    const usage = createUsage(inputTokens, outputTokens);
    const messageId = randomId("msg");
    const outputText = generateOutputText(outputTokens);

    if (!isStream) {
      return c.json({
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [
          {
            type: "text",
            text: outputText,
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        },
      });
    }

    const scenario = c.get("scenario") as TestScenario | undefined;
    const chunkDelayMs = scenario?.streamChunkDelayMs ?? 25;
    const chunkCount = scenario?.streamChunkCount ?? 24;

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return stream(c, async (s) => {
      // message_start：输出 message 元信息（output_tokens 起始为 0）
      await s.write(
        formatSSE("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: usage.input_tokens,
              output_tokens: 0,
            },
          },
        })
      );

      // content_block_delta：按块输出文本
      for await (const chunk of streamTextChunks(outputText, { chunkDelayMs, chunkCount })) {
        await s.write(
          formatSSE("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: chunk,
            },
          })
        );
      }

      // message_delta：输出 stop_reason 与 usage（至少包含 output_tokens）
      await s.write(
        formatSSE("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: "end_turn",
            stop_sequence: null,
          },
          usage: {
            output_tokens: usage.output_tokens,
          },
        })
      );

      await s.write(
        formatSSE("message_stop", {
          type: "message_stop",
        })
      );
    });
  });
}
