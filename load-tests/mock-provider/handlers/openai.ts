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

export function registerOpenAIRoutes(app: Hono): void {
  app.post("/v1/chat/completions", async (c) => {
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

    const model = typeof body.model === "string" ? body.model : "gpt-mock";
    const isStream = body.stream === true;
    const inputTokens = estimateInputTokens(body.messages);
    const outputTokens = parsePositiveInt(body.max_completion_tokens ?? body.max_tokens, 128);
    const usage = createUsage(inputTokens, outputTokens);

    const created = Math.floor(Date.now() / 1000);
    const completionId = randomId("chatcmpl");
    const outputText = generateOutputText(outputTokens);

    if (!isStream) {
      return c.json({
        id: completionId,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: outputText,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
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
      // 首包：仅发送 role，贴近 OpenAI 流式行为
      await s.write(
        formatSSE(undefined, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            },
          ],
        })
      );

      for await (const chunk of streamTextChunks(outputText, { chunkDelayMs, chunkCount })) {
        await s.write(
          formatSSE(undefined, {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: chunk },
                finish_reason: null,
              },
            ],
          })
        );
      }

      // 收尾：finish_reason + usage（OpenAI 兼容层常见写法）
      await s.write(
        formatSSE(undefined, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          },
        })
      );

      await s.write(formatSSE(undefined, "[DONE]"));
    });
  });
}
