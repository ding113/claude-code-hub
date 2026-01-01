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

function pickModel(body: Record<string, unknown>): string {
  if (typeof body.model === "string") return body.model;
  return "gpt-mock";
}

function pickInput(body: Record<string, unknown>): unknown {
  // Responses API：input 既可能是 string，也可能是 message 数组或其它结构
  if ("input" in body) return body.input;
  if ("messages" in body) return body.messages;
  return body;
}

export function registerCodexRoutes(app: Hono): void {
  app.post("/v1/responses", async (c) => {
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

    const model = pickModel(body);
    const isStream = body.stream === true;
    const input = pickInput(body);
    const inputTokens = estimateInputTokens(input);
    const outputTokens = parsePositiveInt(body.max_output_tokens ?? body.max_tokens, 128);
    const usage = createUsage(inputTokens, outputTokens);

    const createdAt = Math.floor(Date.now() / 1000);
    const responseId = randomId("resp");
    const outputText = generateOutputText(outputTokens);

    const responseObject = {
      id: responseId,
      object: "response",
      created_at: createdAt,
      model,
      output: [
        {
          id: randomId("msg"),
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: outputText,
            },
          ],
        },
      ],
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
      },
    };

    if (!isStream) {
      // 注意：本项目的转换器对非流式 codex 响应使用与 SSE 相同的 envelope：{ type, response }
      return c.json({
        type: "response.completed",
        response: responseObject,
      });
    }

    const scenario = c.get("scenario") as TestScenario | undefined;
    const chunkDelayMs = scenario?.streamChunkDelayMs ?? 25;
    const chunkCount = scenario?.streamChunkCount ?? 24;

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return stream(c, async (s) => {
      // response.created：转换器依赖 data.type 与 data.response.id/model/created_at
      await s.write(
        formatSSE("response.created", {
          type: "response.created",
          response: {
            id: responseId,
            object: "response",
            created_at: createdAt,
            model,
          },
        })
      );

      // response.content_part.added：让 Codex→Claude 转换器生成 content_block_start(text)
      await s.write(
        formatSSE("response.content_part.added", {
          type: "response.content_part.added",
          output_index: 0,
        })
      );

      for await (const chunk of streamTextChunks(outputText, { chunkDelayMs, chunkCount })) {
        await s.write(
          formatSSE("response.output_text.delta", {
            type: "response.output_text.delta",
            output_index: 0,
            delta: chunk,
          })
        );
      }

      await s.write(
        formatSSE("response.content_part.done", {
          type: "response.content_part.done",
          output_index: 0,
        })
      );

      // response.completed：包含 usage，供 Codex→OpenAI/Claude 转换器补全 usage 与 finish_reason
      await s.write(
        formatSSE("response.completed", {
          type: "response.completed",
          response: responseObject,
        })
      );
    });
  });
}
