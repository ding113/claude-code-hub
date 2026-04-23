import { describe, expect, it } from "vitest";
import {
  extractActualResponseModel,
  kindFromClientFormat,
  kindFromProviderType,
} from "@/app/v1/_lib/proxy/actual-response-model";

describe("kindFromClientFormat", () => {
  it("maps ClientFormat + stream flag to ExtractKind", () => {
    expect(kindFromClientFormat("claude", false)).toBe("anthropic/non-stream");
    expect(kindFromClientFormat("claude", true)).toBe("anthropic/stream");
    expect(kindFromClientFormat("openai", false)).toBe("openai-chat/non-stream");
    expect(kindFromClientFormat("openai", true)).toBe("openai-chat/stream");
    expect(kindFromClientFormat("response", false)).toBe("openai-responses/non-stream");
    expect(kindFromClientFormat("response", true)).toBe("openai-responses/stream");
    expect(kindFromClientFormat("gemini", false)).toBe("gemini/non-stream");
    expect(kindFromClientFormat("gemini", true)).toBe("gemini/stream");
    expect(kindFromClientFormat("gemini-cli", false)).toBe("gemini/non-stream");
    expect(kindFromClientFormat("gemini-cli", true)).toBe("gemini/stream");
  });
});

describe("kindFromProviderType", () => {
  it("maps ProviderType + stream flag to ExtractKind (this is the runtime entry point)", () => {
    expect(kindFromProviderType("claude", false)).toBe("anthropic/non-stream");
    expect(kindFromProviderType("claude-auth", true)).toBe("anthropic/stream");
    expect(kindFromProviderType("openai-compatible", false)).toBe("openai-chat/non-stream");
    expect(kindFromProviderType("openai-compatible", true)).toBe("openai-chat/stream");
    expect(kindFromProviderType("codex", false)).toBe("openai-responses/non-stream");
    expect(kindFromProviderType("codex", true)).toBe("openai-responses/stream");
    expect(kindFromProviderType("gemini", false)).toBe("gemini/non-stream");
    expect(kindFromProviderType("gemini-cli", true)).toBe("gemini/stream");
  });
});

describe("extractActualResponseModel - 8 happy-path cases", () => {
  // fixtures directly mirror shapes from:
  // - OpenAI Chat Completions docs (platform.openai.com/docs/api-reference/chat)
  // - OpenAI Responses docs (platform.openai.com/docs/api-reference/responses)
  // - Anthropic Messages docs (docs.anthropic.com/en/api/messages + streaming)
  // - Gemini generateContent schema (ai.google.dev/api/generate-content)

  it("openai-chat/non-stream: reads top-level $.model", () => {
    const body = JSON.stringify({
      id: "chatcmpl-abc",
      object: "chat.completion",
      created: 1710000000,
      model: "gpt-5-2025-08-07",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
    });
    expect(extractActualResponseModel("openai-chat/non-stream", body)).toBe("gpt-5-2025-08-07");
  });

  it("openai-chat/stream: reads first chunk $.model", () => {
    const stream = [
      `data: ${JSON.stringify({
        id: "chatcmpl-abc",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ delta: { role: "assistant" }, index: 0 }],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "chatcmpl-abc",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ delta: { content: "Hi" }, index: 0 }],
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractActualResponseModel("openai-chat/stream", stream)).toBe("gpt-4o-mini");
  });

  it("openai-responses/non-stream: reads top-level $.model (real vs alias)", () => {
    const body = JSON.stringify({
      object: "response",
      id: "resp_123",
      model: "gpt-4.1-2025-04-14",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi" }],
        },
      ],
    });
    expect(extractActualResponseModel("openai-responses/non-stream", body)).toBe(
      "gpt-4.1-2025-04-14"
    );
  });

  it("openai-responses/stream: reads $.response.model from envelope events", () => {
    const stream = [
      "event: response.created",
      `data: ${JSON.stringify({
        type: "response.created",
        response: {
          id: "resp_123",
          object: "response",
          model: "gpt-4.1-2025-04-14",
          status: "in_progress",
        },
      })}`,
      "",
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "H" })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { id: "resp_123", model: "gpt-4.1-2025-04-14", status: "completed" },
      })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModel("openai-responses/stream", stream)).toBe(
      "gpt-4.1-2025-04-14"
    );
  });

  it("anthropic/non-stream: reads top-level $.model", () => {
    const body = JSON.stringify({
      id: "msg_abc",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(extractActualResponseModel("anthropic/non-stream", body)).toBe("claude-opus-4-7");
  });

  it("anthropic/stream: reads message_start.message.model only", () => {
    const stream = [
      "event: message_start",
      `data: ${JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_abc",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-7",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      })}`,
      "",
      "event: content_block_start",
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      })}`,
      "",
      ": ping",
      "",
      "event: message_delta",
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      })}`,
      "",
      "event: message_stop",
      `data: ${JSON.stringify({ type: "message_stop" })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModel("anthropic/stream", stream)).toBe("claude-opus-4-7");
  });

  it("gemini/non-stream: reads $.modelVersion (not $.model)", () => {
    const body = JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "Hi" }], role: "model" },
          finishReason: "STOP",
          index: 0,
        },
      ],
      modelVersion: "gemini-2.5-flash",
      responseId: "mAitaLmkHPPlz7IPvtfUqQ4",
    });
    expect(extractActualResponseModel("gemini/non-stream", body)).toBe("gemini-2.5-flash");
  });

  it("gemini/stream: reads first chunk $.modelVersion", () => {
    const stream = [
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: "H" }], role: "model" }, index: 0 }],
        modelVersion: "gemini-2.5-flash-lite",
        responseId: "mAitaLmkHPPlz7IPvtfUqQ4",
      })}`,
      "",
      `data: ${JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "i" }], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        modelVersion: "gemini-2.5-flash-lite",
        responseId: "mAitaLmkHPPlz7IPvtfUqQ4",
      })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModel("gemini/stream", stream)).toBe("gemini-2.5-flash-lite");
  });
});

describe("extractActualResponseModel - edge cases", () => {
  it("returns null for empty / whitespace-only input", () => {
    expect(extractActualResponseModel("openai-chat/non-stream", "")).toBeNull();
    expect(extractActualResponseModel("anthropic/stream", "   \n\n   ")).toBeNull();
    expect(extractActualResponseModel("gemini/stream", null)).toBeNull();
    expect(extractActualResponseModel("openai-chat/stream", undefined)).toBeNull();
  });

  it("returns null for malformed JSON without throwing", () => {
    expect(extractActualResponseModel("openai-chat/non-stream", "not-json")).toBeNull();
    expect(extractActualResponseModel("gemini/non-stream", "{model:broken")).toBeNull();
    const malformedStream = "data: {not valid\n\ndata: also not valid\n\n";
    expect(extractActualResponseModel("openai-chat/stream", malformedStream)).toBeNull();
  });

  it("returns null when stream contains only [DONE] / ping / keep-alive", () => {
    const donOnly = ["data: [DONE]", ""].join("\n");
    expect(extractActualResponseModel("openai-chat/stream", donOnly)).toBeNull();
    const pingOnly = [": keep-alive", "", ": ping", "", "event: ping", "data: {}", ""].join("\n");
    expect(extractActualResponseModel("anthropic/stream", pingOnly)).toBeNull();
  });

  it("anthropic/stream returns null when message_start is absent (e.g. only deltas)", () => {
    const stream = [
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModel("anthropic/stream", stream)).toBeNull();
  });

  it("openai-responses/stream ignores text-delta events and reads envelope when present", () => {
    const streamOnlyDeltas = [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hi" })}`,
      "",
    ].join("\n");
    expect(extractActualResponseModel("openai-responses/stream", streamOnlyDeltas)).toBeNull();
  });

  it("openai-responses/stream parses NDJSON transcript (Codex relay shape)", () => {
    // Codex relay can buffer events as NDJSON rather than SSE;
    // the extractor must still find the envelope event via data-less lines.
    const ndjson = [
      JSON.stringify({ type: "response.created", response: { model: "gpt-4.1-2025-04-14" } }),
      JSON.stringify({ type: "response.output_text.delta", delta: "Hi" }),
      JSON.stringify({ type: "response.completed", response: { model: "gpt-4.1-2025-04-14" } }),
    ].join("\n");
    expect(extractActualResponseModel("openai-responses/stream", ndjson)).toBe(
      "gpt-4.1-2025-04-14"
    );
  });

  it("model string is treated as opaque (HF-style slash is preserved)", () => {
    const body = JSON.stringify({
      id: "chatcmpl-local",
      object: "chat.completion",
      model: "NousResearch/Meta-Llama-3-8B-Instruct",
      choices: [],
    });
    expect(extractActualResponseModel("openai-chat/non-stream", body)).toBe(
      "NousResearch/Meta-Llama-3-8B-Instruct"
    );
  });

  it("gemini supports snake_case model_version fallback (SDK shape)", () => {
    const body = JSON.stringify({
      candidates: [],
      model_version: "gemini-2.5-flash",
    });
    expect(extractActualResponseModel("gemini/non-stream", body)).toBe("gemini-2.5-flash");
  });

  it("openai-chat/stream caches first model hit and does not require every chunk to carry it", () => {
    const stream = [
      `data: ${JSON.stringify({
        id: "chatcmpl-x",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ delta: { content: "A" }, index: 0 }],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "chatcmpl-x",
        object: "chat.completion.chunk",
        created: 1,
        choices: [{ delta: { content: "B" }, index: 0, finish_reason: "stop" }],
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(extractActualResponseModel("openai-chat/stream", stream)).toBe("gpt-4o-mini");
  });
});
