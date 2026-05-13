import { describe, expect, it } from "vitest";
import { ensureOpenAIChatStreamUsageOption } from "./openai-chat-usage-options";

describe("ensureOpenAIChatStreamUsageOption", () => {
  it("adds include_usage for OpenAI-compatible streaming chat completions", () => {
    const body: Record<string, unknown> = {
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    };

    const changed = ensureOpenAIChatStreamUsageOption(
      body,
      "openai-compatible",
      "/v1/chat/completions"
    );

    expect(changed).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("preserves existing stream options while forcing include_usage", () => {
    const body: Record<string, unknown> = {
      stream: true,
      stream_options: { foo: "bar", include_usage: false },
    };

    const changed = ensureOpenAIChatStreamUsageOption(
      body,
      "openai-compatible",
      "/v1/chat/completions"
    );

    expect(changed).toBe(true);
    expect(body.stream_options).toEqual({ foo: "bar", include_usage: true });
  });

  it("does not touch non-streaming chat completions", () => {
    const body: Record<string, unknown> = {
      stream: false,
    };

    const changed = ensureOpenAIChatStreamUsageOption(
      body,
      "openai-compatible",
      "/v1/chat/completions"
    );

    expect(changed).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });

  it("does not touch other provider types", () => {
    const body: Record<string, unknown> = {
      stream: true,
    };

    const changed = ensureOpenAIChatStreamUsageOption(body, "claude", "/v1/chat/completions");

    expect(changed).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });
});
