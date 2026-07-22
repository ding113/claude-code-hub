import { describe, expect, test } from "vitest";
import {
  validateUpstreamResponse,
  type ProtocolFamily,
} from "@/app/v1/_lib/proxy/fake-streaming/response-validator";

function failure(family: ProtocolFamily, body: string, isStream: boolean, status = 200) {
  return validateUpstreamResponse({
    family,
    status,
    body,
    isStream,
  });
}

describe("validateUpstreamResponse", () => {
  describe("status code handling", () => {
    test.each<ProtocolFamily>([
      "anthropic",
      "openai-chat",
      "openai-responses",
      "gemini",
    ])("%s: non-2xx is failure regardless of body", (family) => {
      const valid = `{"id":"ok","model":"m","content":[{"type":"text","text":"hi"}]}`;
      expect(failure(family, valid, false, 500).ok).toBe(false);
      expect(failure(family, valid, false, 502).ok).toBe(false);
      expect(failure(family, valid, false, 429).ok).toBe(false);
      expect(failure(family, valid, false, 401).ok).toBe(false);
    });
  });

  describe("empty / whitespace bodies", () => {
    test.each<ProtocolFamily>([
      "anthropic",
      "openai-chat",
      "openai-responses",
      "gemini",
    ])("%s: empty body fails (non-stream)", (family) => {
      expect(failure(family, "", false).ok).toBe(false);
      expect(failure(family, "   ", false).ok).toBe(false);
      expect(failure(family, "\n\n  \t\n", false).ok).toBe(false);
    });

    test.each<ProtocolFamily>([
      "anthropic",
      "openai-chat",
      "openai-responses",
      "gemini",
    ])("%s: empty body fails (stream)", (family) => {
      expect(failure(family, "", true).ok).toBe(false);
      expect(failure(family, "   ", true).ok).toBe(false);
    });
  });

  describe("invalid JSON for non-stream", () => {
    test.each<ProtocolFamily>([
      "anthropic",
      "openai-chat",
      "openai-responses",
      "gemini",
    ])("%s: invalid JSON fails non-stream", (family) => {
      expect(failure(family, "not-json", false).ok).toBe(false);
      expect(failure(family, "{ truncated", false).ok).toBe(false);
    });
  });

  describe("SSE failure cases", () => {
    test.each<ProtocolFamily>([
      "anthropic",
      "openai-chat",
      "openai-responses",
      "gemini",
    ])("%s: comment-only SSE fails", (family) => {
      expect(failure(family, ": ping\n\n: ping\n\n", true).ok).toBe(false);
    });

    test("openai-chat: [DONE]-only SSE fails", () => {
      expect(failure("openai-chat", "data: [DONE]\n\n", true).ok).toBe(false);
    });

    test("openai-chat: error SSE fails", () => {
      const errEvent = `event: error\ndata: {"error":{"message":"upstream"}}\n\n`;
      expect(failure("openai-chat", errEvent, true).ok).toBe(false);
    });

    test("anthropic: error SSE fails", () => {
      const errEvent = `event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n`;
      expect(failure("anthropic", errEvent, true).ok).toBe(false);
    });

    test("openai-chat: usage-only chunk fails (no delta content / tool_calls)", () => {
      const usageOnly = `data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{},"index":0}],"usage":{"completion_tokens":3}}\n\ndata: [DONE]\n\n`;
      expect(failure("openai-chat", usageOnly, true).ok).toBe(false);
    });
  });

  describe("non-stream success cases", () => {
    test("anthropic: text content_block accepted", () => {
      const body = JSON.stringify({
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-3",
        content: [{ type: "text", text: "hello" }],
      });
      expect(failure("anthropic", body, false).ok).toBe(true);
    });

    test("anthropic: tool_use block accepted (no text)", () => {
      const body = JSON.stringify({
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-3",
        content: [{ type: "tool_use", id: "tu_1", name: "foo", input: { x: 1 } }],
      });
      expect(failure("anthropic", body, false).ok).toBe(true);
    });

    test("openai-chat: text choice accepted", () => {
      const body = JSON.stringify({
        id: "x",
        object: "chat.completion",
        choices: [{ message: { content: "hi" }, index: 0, finish_reason: "stop" }],
      });
      expect(failure("openai-chat", body, false).ok).toBe(true);
    });

    test("openai-chat: function_call accepted (no text)", () => {
      const body = JSON.stringify({
        id: "x",
        object: "chat.completion",
        choices: [
          {
            message: {
              tool_calls: [{ id: "t", type: "function", function: { name: "f", arguments: "{}" } }],
            },
            index: 0,
            finish_reason: "tool_calls",
          },
        ],
      });
      expect(failure("openai-chat", body, false).ok).toBe(true);
    });

    test("openai-responses: text output_item accepted", () => {
      const body = JSON.stringify({
        id: "resp_1",
        object: "response",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hi" }],
          },
        ],
      });
      expect(failure("openai-responses", body, false).ok).toBe(true);
    });

    test("openai-responses: structured output accepted", () => {
      const body = JSON.stringify({
        id: "resp_1",
        object: "response",
        output: [
          {
            type: "function_call",
            name: "foo",
            arguments: "{}",
          },
        ],
      });
      expect(failure("openai-responses", body, false).ok).toBe(true);
    });

    test("gemini: candidates accepted", () => {
      const body = JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "hi" }] },
            finishReason: "STOP",
          },
        ],
      });
      expect(failure("gemini", body, false).ok).toBe(true);
    });

    test("gemini: candidates with image bytes only also accepted (no text)", () => {
      const body = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
            },
            finishReason: "STOP",
          },
        ],
      });
      expect(failure("gemini", body, false).ok).toBe(true);
    });
  });

  describe("non-stream failure cases", () => {
    test("anthropic: empty content array fails", () => {
      const body = JSON.stringify({
        id: "msg",
        type: "message",
        content: [],
      });
      expect(failure("anthropic", body, false).ok).toBe(false);
    });

    test("openai-chat: empty choices array fails", () => {
      const body = JSON.stringify({
        id: "x",
        object: "chat.completion",
        choices: [],
      });
      expect(failure("openai-chat", body, false).ok).toBe(false);
    });

    test("openai-chat: choice with empty message content + no tool_calls fails", () => {
      const body = JSON.stringify({
        id: "x",
        object: "chat.completion",
        choices: [{ message: { content: "" }, index: 0, finish_reason: "stop" }],
      });
      expect(failure("openai-chat", body, false).ok).toBe(false);
    });

    test("openai-responses: empty output array fails", () => {
      const body = JSON.stringify({
        id: "resp_1",
        object: "response",
        output: [],
      });
      expect(failure("openai-responses", body, false).ok).toBe(false);
    });

    test("gemini: empty candidates array fails", () => {
      const body = JSON.stringify({ candidates: [] });
      expect(failure("gemini", body, false).ok).toBe(false);
    });

    test("gemini: candidate with no content parts fails", () => {
      const body = JSON.stringify({
        candidates: [{ finishReason: "STOP" }],
      });
      expect(failure("gemini", body, false).ok).toBe(false);
    });
  });

  describe("stream success cases", () => {
    test("anthropic: message_start + content_block_delta accepted", () => {
      const sse =
        `event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-3","content":[]}}\n\n` +
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n` +
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
      expect(failure("anthropic", sse, true).ok).toBe(true);
    });

    test("openai-chat: chunks with delta content + [DONE] accepted", () => {
      const sse =
        `data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"},"index":0}]}\n\n` +
        `data: [DONE]\n\n`;
      expect(failure("openai-chat", sse, true).ok).toBe(true);
    });

    test("openai-chat: tool_calls delta accepted", () => {
      const sse =
        `data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"t","type":"function","function":{"name":"f","arguments":"{}"}}]},"index":0}]}\n\n` +
        `data: [DONE]\n\n`;
      expect(failure("openai-chat", sse, true).ok).toBe(true);
    });

    test("openai-responses: response.created + completed accepted", () => {
      const sse =
        `event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","object":"response","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}]}}\n\n` +
        `event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","object":"response","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}]}}\n\n`;
      expect(failure("openai-responses", sse, true).ok).toBe(true);
    });

    test("gemini: data event with candidates accepted", () => {
      const sse = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
      })}\n\n`;
      expect(failure("gemini", sse, true).ok).toBe(true);
    });
  });
});
