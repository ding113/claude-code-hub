import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { TestScenario } from "../../../load-tests/mock-provider/config/scenarios";
import { registerClaudeRoutes } from "../../../load-tests/mock-provider/handlers/claude";
import { registerCodexRoutes } from "../../../load-tests/mock-provider/handlers/codex";
import { registerOpenAIRoutes } from "../../../load-tests/mock-provider/handlers/openai";

function createTestApp(): Hono {
  const scenario: TestScenario = {
    name: "unit-test",
    description: "用于单测：关闭延迟与错误、最小化 chunk。",
    latencyMinMs: 0,
    latencyMaxMs: 0,
    errorRate: 0,
    errorTypes: [],
    streamChunkDelayMs: 0,
    streamChunkCount: 5,
  };

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("scenario", scenario);
    await next();
  });

  registerClaudeRoutes(app);
  registerOpenAIRoutes(app);
  registerCodexRoutes(app);
  return app;
}

describe("mock-provider handlers", () => {
  test("Claude 非流式 /v1/messages", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-mock",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.type).toBe("message");
    expect(data.usage.input_tokens).toBeGreaterThanOrEqual(1);
    expect(data.usage.output_tokens).toBeGreaterThanOrEqual(1);
  });

  test("Claude 流式 /v1/messages", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-mock",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        max_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_delta");
    expect(text).toContain("event: message_stop");
  });

  test("OpenAI 非流式 /v1/chat/completions", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.object).toBe("chat.completion");
    expect(data.choices?.[0]?.message?.content?.length).toBeGreaterThan(0);
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  });

  test("OpenAI 流式 /v1/chat/completions", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        max_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:");
    expect(text).toContain("chat.completion.chunk");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  test("Codex 非流式 /v1/responses", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        input: "hi",
        max_output_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.type).toBe("response.completed");
    expect(data.response?.usage?.input_tokens).toBeGreaterThanOrEqual(1);
  });

  test("Codex 流式 /v1/responses", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-mock",
        input: "hi",
        stream: true,
        max_output_tokens: 8,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain('"type":"response.output_text.delta"');
    expect(text).toContain('"type":"response.completed"');
  });
});
