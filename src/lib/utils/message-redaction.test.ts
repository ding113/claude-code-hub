import { describe, expect, test } from "vitest";
import {
  REDACTED_MARKER,
  redactJsonString,
  redactMessages,
  redactRequestBody,
  redactResponseBody,
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

  describe("redactRequestBody - Gemini formats", () => {
    test("should redact Gemini contents[] format", () => {
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Secret user message" }],
          },
          {
            role: "model",
            parts: [{ text: "Secret model response" }],
          },
        ],
        generationConfig: { temperature: 0.7 },
      };

      const result = redactRequestBody(body) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: { temperature: number };
      };

      expect(result.contents[0].parts[0].text).toBe(REDACTED_MARKER);
      expect(result.contents[1].parts[0].text).toBe(REDACTED_MARKER);
      expect(result.generationConfig.temperature).toBe(0.7);
    });

    test("should redact Gemini request.contents[] format (CLI wrapper)", () => {
      const body = {
        model: "gemini-2.0-flash",
        request: {
          systemInstruction: {
            role: "user",
            parts: [{ text: "Secret system instruction" }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: "Secret user message" }],
            },
          ],
          generationConfig: { temperature: 0.5 },
        },
      };

      const result = redactRequestBody(body) as {
        model: string;
        request: {
          systemInstruction: { parts: Array<{ text: string }> };
          contents: Array<{ parts: Array<{ text: string }> }>;
          generationConfig: { temperature: number };
        };
      };

      expect(result.model).toBe("gemini-2.0-flash");
      expect(result.request.systemInstruction.parts[0].text).toBe(REDACTED_MARKER);
      expect(result.request.contents[0].parts[0].text).toBe(REDACTED_MARKER);
      expect(result.request.generationConfig.temperature).toBe(0.5);
    });

    test("should redact Gemini parts with functionCall (preserve structure)", () => {
      const body = {
        contents: [
          {
            role: "model",
            parts: [
              { text: "Let me search for that" },
              {
                functionCall: {
                  name: "search",
                  args: { query: "secret query" },
                },
              },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as {
        contents: Array<{
          parts: Array<{
            text?: string;
            functionCall?: { name: string; args: unknown };
          }>;
        }>;
      };

      expect(result.contents[0].parts[0].text).toBe(REDACTED_MARKER);
      expect(result.contents[0].parts[1].functionCall?.name).toBe("search");
      expect(result.contents[0].parts[1].functionCall?.args).toBe(REDACTED_MARKER);
    });

    test("should redact Gemini parts with inlineData", () => {
      const body = {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: "base64encodeddata",
                },
              },
            ],
          },
        ],
      };

      const result = redactRequestBody(body) as {
        contents: Array<{
          parts: Array<{ inlineData: { mimeType: string; data: string } }>;
        }>;
      };

      expect(result.contents[0].parts[0].inlineData.mimeType).toBe("image/png");
      expect(result.contents[0].parts[0].inlineData.data).toBe(REDACTED_MARKER);
    });
  });

  describe("redactResponseBody", () => {
    test("should redact OpenAI choices[].message.content", () => {
      const body = {
        id: "chatcmpl-123",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Secret response content",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      };

      const result = redactResponseBody(body) as {
        id: string;
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number };
      };

      expect(result.id).toBe("chatcmpl-123");
      expect(result.choices[0].message.content).toBe(REDACTED_MARKER);
      expect(result.usage.prompt_tokens).toBe(10);
    });

    test("should redact OpenAI choices[].delta.content (streaming)", () => {
      const body = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              content: "Secret delta content",
            },
          },
        ],
      };

      const result = redactResponseBody(body) as {
        choices: Array<{ delta: { content: string } }>;
      };

      expect(result.choices[0].delta.content).toBe(REDACTED_MARKER);
    });

    test("should redact Claude content[] blocks", () => {
      const body = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Secret text response" },
          { type: "thinking", thinking: "Secret thinking content" },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const result = redactResponseBody(body) as {
        id: string;
        content: Array<{ type: string; text?: string; thinking?: string }>;
      };

      expect(result.id).toBe("msg_123");
      expect(result.content[0].text).toBe(REDACTED_MARKER);
      expect(result.content[1].thinking).toBe(REDACTED_MARKER);
    });

    test("should redact Claude tool_use input in response", () => {
      const body = {
        id: "msg_123",
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "search",
            input: { query: "secret query" },
          },
        ],
      };

      const result = redactResponseBody(body) as {
        content: Array<{ type: string; input: unknown }>;
      };

      expect(result.content[0].input).toBe(REDACTED_MARKER);
    });

    test("should redact Codex response.output[] format", () => {
      const body = {
        type: "response.completed",
        response: {
          id: "resp_123",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Secret output" }],
            },
            {
              type: "reasoning",
              summary: [{ type: "text", text: "Secret reasoning" }],
            },
            {
              type: "function_call",
              call_id: "call_123",
              name: "search",
              arguments: '{"query": "secret"}',
            },
          ],
        },
      };

      const result = redactResponseBody(body) as {
        response: {
          output: Array<{
            type: string;
            content?: Array<{ text: string }>;
            summary?: Array<{ text: string }>;
            arguments?: string;
          }>;
        };
      };

      expect(result.response.output[0].content?.[0].text).toBe(REDACTED_MARKER);
      expect(result.response.output[1].summary?.[0].text).toBe(REDACTED_MARKER);
      expect(result.response.output[2].arguments).toBe(REDACTED_MARKER);
    });

    test("should redact Gemini candidates[].content.parts[]", () => {
      const body = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Secret Gemini response" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10 },
      };

      const result = redactResponseBody(body) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        usageMetadata: { promptTokenCount: number };
      };

      expect(result.candidates[0].content.parts[0].text).toBe(REDACTED_MARKER);
      expect(result.usageMetadata.promptTokenCount).toBe(10);
    });

    test("should redact Gemini CLI wrapped response", () => {
      const body = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Secret response" }, { thought: true, text: "Secret thought" }],
              },
            },
          ],
        },
      };

      const result = redactResponseBody(body) as {
        response: {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        };
      };

      expect(result.response.candidates[0].content.parts[0].text).toBe(REDACTED_MARKER);
      expect(result.response.candidates[0].content.parts[1].text).toBe(REDACTED_MARKER);
    });

    test("should return non-object input as-is", () => {
      expect(redactResponseBody(null)).toBe(null);
      expect(redactResponseBody("string")).toBe("string");
      expect(redactResponseBody(123)).toBe(123);
    });

    test("should handle empty response body", () => {
      expect(redactResponseBody({})).toEqual({});
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
