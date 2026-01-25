import { describe, expect, test } from "vitest";
import {
  REDACTED_MARKER,
  redactJsonString,
  redactMessages,
  redactRequestBody,
} from "@/lib/utils/message-redaction";

describe("message-redaction", () => {
  describe("redactRequestBody", () => {
    test("should redact simple string message content", () => {
      const body = {
        model: "claude-3-opus",
        messages: [
          { role: "user", content: "Hello, this is a secret message" },
          { role: "assistant", content: "I understand your secret" },
        ],
      };

      const result = redactRequestBody(body);

      expect(result).toEqual({
        model: "claude-3-opus",
        messages: [
          { role: "user", content: REDACTED_MARKER },
          { role: "assistant", content: REDACTED_MARKER },
        ],
      });
    });

    test("should redact array content with text blocks", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Secret text content" },
              { type: "text", text: "Another secret" },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as { messages: Array<{ content: unknown[] }> };

      expect(result.messages[0].content).toEqual([
        { type: "text", text: REDACTED_MARKER },
        { type: "text", text: REDACTED_MARKER },
      ]);
    });

    test("should redact image source data", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "base64encodedimagedata",
                },
              },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as { messages: Array<{ content: unknown[] }> };
      const imageBlock = result.messages[0].content[0] as { source: { data: string } };

      expect(imageBlock.source.data).toBe(REDACTED_MARKER);
    });

    test("should redact tool_use input", () => {
      const body = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_123",
                name: "search",
                input: { query: "secret search query" },
              },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as { messages: Array<{ content: unknown[] }> };
      const toolBlock = result.messages[0].content[0] as { input: string };

      expect(toolBlock.input).toBe(REDACTED_MARKER);
    });

    test("should redact tool_result content", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: "Secret tool result",
              },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as { messages: Array<{ content: unknown[] }> };
      const toolResultBlock = result.messages[0].content[0] as { content: string };

      expect(toolResultBlock.content).toBe(REDACTED_MARKER);
    });

    test("should redact system prompt string", () => {
      const body = {
        system: "You are a helpful assistant with secret instructions",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = redactRequestBody(body);

      expect(result).toEqual({
        system: REDACTED_MARKER,
        messages: [{ role: "user", content: REDACTED_MARKER }],
      });
    });

    test("should redact system prompt array", () => {
      const body = {
        system: [
          { type: "text", text: "Secret system instruction 1" },
          { type: "text", text: "Secret system instruction 2" },
        ],
        messages: [],
      };

      const result = redactRequestBody(body) as { system: unknown[] };

      expect(result.system).toEqual([
        { type: "text", text: REDACTED_MARKER },
        { type: "text", text: REDACTED_MARKER },
      ]);
    });

    test("should redact input array (Response API format)", () => {
      const body = {
        model: "claude-3-opus",
        input: [
          { role: "user", content: "Secret input content" },
          { role: "assistant", content: "Secret response" },
        ],
      };

      const result = redactRequestBody(body);

      expect(result).toEqual({
        model: "claude-3-opus",
        input: [
          { role: "user", content: REDACTED_MARKER },
          { role: "assistant", content: REDACTED_MARKER },
        ],
      });
    });

    test("should preserve non-content fields", () => {
      const body = {
        model: "claude-3-opus",
        max_tokens: 1024,
        temperature: 0.7,
        messages: [{ role: "user", content: "Secret" }],
      };

      const result = redactRequestBody(body) as Record<string, unknown>;

      expect(result.model).toBe("claude-3-opus");
      expect(result.max_tokens).toBe(1024);
      expect(result.temperature).toBe(0.7);
    });

    test("should handle empty messages array", () => {
      const body = { model: "test", messages: [] };

      const result = redactRequestBody(body);

      expect(result).toEqual({ model: "test", messages: [] });
    });

    test("should return non-object input as-is", () => {
      expect(redactRequestBody(null)).toBe(null);
      expect(redactRequestBody("string")).toBe("string");
      expect(redactRequestBody(123)).toBe(123);
      expect(redactRequestBody(undefined)).toBe(undefined);
    });

    test("should handle mixed content array", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              "plain string content",
              { type: "text", text: "text block" },
              { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as { messages: Array<{ content: unknown[] }> };

      expect(result.messages[0].content[0]).toBe(REDACTED_MARKER);
      expect((result.messages[0].content[1] as { text: string }).text).toBe(REDACTED_MARKER);
      // URL-based images don't have data to redact
      expect(result.messages[0].content[2]).toEqual({
        type: "image",
        source: { type: "url", url: "https://example.com/image.png" },
      });
    });
  });

  describe("redactJsonString", () => {
    test("should redact JSON string and return formatted JSON", () => {
      const json = JSON.stringify({
        messages: [{ role: "user", content: "Secret" }],
      });

      const result = redactJsonString(json);
      const parsed = JSON.parse(result);

      expect(parsed.messages[0].content).toBe(REDACTED_MARKER);
    });

    test("should return original string if JSON parsing fails", () => {
      const invalidJson = "not valid json";

      const result = redactJsonString(invalidJson);

      expect(result).toBe(invalidJson);
    });

    test("should handle empty JSON object", () => {
      const json = "{}";

      const result = redactJsonString(json);

      expect(result).toBe("{}");
    });
  });

  describe("redactMessages", () => {
    test("should redact messages array directly", () => {
      const messages = [
        { role: "user", content: "Hello secret" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = redactMessages(messages) as Array<{ content: string }>;

      expect(result[0].content).toBe(REDACTED_MARKER);
      expect(result[1].content).toBe(REDACTED_MARKER);
    });

    test("should return non-array input as-is", () => {
      expect(redactMessages(null)).toBe(null);
      expect(redactMessages("string")).toBe("string");
      expect(redactMessages({})).toEqual({});
    });

    test("should handle messages with nested tool_result content array", () => {
      const messages = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: [{ type: "text", text: "Tool output text" }],
            },
          ],
        },
      ];

      const result = redactMessages(messages) as Array<{ content: unknown[] }>;
      const toolResult = result[0].content[0] as { content: unknown[] };

      expect((toolResult.content[0] as { text: string }).text).toBe(REDACTED_MARKER);
    });
  });
});
