import { describe, expect, test } from "vitest";
import { detectSSEFirstBlockError } from "@/lib/utils/sse";
import {
  SSEErrorResponseError,
  isSSEErrorResponseError,
  categorizeErrorAsync,
  ErrorCategory,
} from "@/app/v1/_lib/proxy/errors";

function buildSse(events: Array<{ event?: string; data: unknown }>): string {
  return events
    .flatMap(({ event, data }) => {
      const lines: string[] = [];
      if (event) {
        lines.push(`event: ${event}`);
      }
      lines.push(`data: ${JSON.stringify(data)}`);
      lines.push("");
      return lines;
    })
    .join("\n");
}

describe("detectSSEFirstBlockError", () => {
  describe("explicit event: error format", () => {
    test("should detect event: error with nested error object", () => {
      const sseText = `event: error
data: {"error":{"code":"1302","message":"High concurrency usage of this API, please reduce concurrency or contact customer service to increase limits"},"request_id":"2026012315301053eda1059a6e4f85"}

data: [DONE]`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("1302");
      expect(result?.errorMessage).toBe(
        "High concurrency usage of this API, please reduce concurrency or contact customer service to increase limits"
      );
      expect(result?.rawData).toBeDefined();
    });

    test("should detect event: error with type field instead of code", () => {
      const sseText = buildSse([
        {
          event: "error",
          data: {
            error: {
              type: "overloaded_error",
              message: "Server is overloaded",
            },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("overloaded_error");
      expect(result?.errorMessage).toBe("Server is overloaded");
    });

    test("should detect event: error with plain text data", () => {
      const sseText = `event: error
data: Connection reset by peer

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorMessage).toBe("Connection reset by peer");
    });

    test("should detect event: error with top-level message", () => {
      const sseText = buildSse([
        {
          event: "error",
          data: {
            message: "Rate limit exceeded",
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorMessage).toBe("Rate limit exceeded");
    });
  });

  describe("type: error format (Claude API style)", () => {
    test("should detect data block with type: error", () => {
      const sseText = buildSse([
        {
          event: "error",
          data: {
            type: "error",
            error: {
              type: "rate_limit_error",
              message: "Rate limit exceeded. Please retry after a moment.",
            },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("rate_limit_error");
      expect(result?.errorMessage).toBe("Rate limit exceeded. Please retry after a moment.");
    });

    test("should detect type: error without event prefix", () => {
      const sseText = `data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("overloaded_error");
      expect(result?.errorMessage).toBe("Overloaded");
    });
  });

  describe("embedded error object format", () => {
    test("should detect first data block with top-level error object", () => {
      const sseText = `data: {"error":{"code":"500","message":"Internal server error"}}

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("500");
      expect(result?.errorMessage).toBe("Internal server error");
    });

    test("should detect error with type field in error object", () => {
      const sseText = buildSse([
        {
          data: {
            error: {
              type: "authentication_error",
              message: "Invalid API key",
            },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorCode).toBe("authentication_error");
      expect(result?.errorMessage).toBe("Invalid API key");
    });
  });

  describe("normal SSE streams (should return null)", () => {
    test("should return null for normal Claude message_start event", () => {
      const sseText = buildSse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_01XFDUDYJgAACzvnptvVoYEL",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-3-opus-20240229",
            },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).toBeNull();
    });

    test("should return null for normal content_block_delta event", () => {
      const sseText = buildSse([
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hello" },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).toBeNull();
    });

    test("should return null for OpenAI chat completion chunk", () => {
      const sseText = buildSse([
        {
          data: {
            id: "chatcmpl-123",
            object: "chat.completion.chunk",
            created: 1677652288,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                delta: { content: "Hello" },
                finish_reason: null,
              },
            ],
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).toBeNull();
    });

    test("should return null for Gemini stream response", () => {
      const sseText = `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).toBeNull();
    });

    test("should return null for empty SSE text", () => {
      const result = detectSSEFirstBlockError("");

      expect(result).toBeNull();
    });

    test("should return null for SSE with only [DONE]", () => {
      const sseText = `data: [DONE]

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("should handle malformed JSON gracefully", () => {
      const sseText = `event: error
data: {invalid json}

`;

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.errorMessage).toBe("{invalid json}");
    });

    test("should truncate rawData to 500 characters", () => {
      const longMessage = "A".repeat(1000);
      const sseText = buildSse([
        {
          event: "error",
          data: {
            error: {
              code: "500",
              message: longMessage,
            },
          },
        },
      ]);

      const result = detectSSEFirstBlockError(sseText);

      expect(result).not.toBeNull();
      expect(result?.rawData.length).toBeLessThanOrEqual(500);
    });
  });
});

describe("SSEErrorResponseError", () => {
  test("should create error with correct properties", () => {
    const error = new SSEErrorResponseError(
      1,
      "test-provider",
      "1302",
      "High concurrency",
      "raw data here"
    );

    expect(error.name).toBe("SSEErrorResponseError");
    expect(error.providerId).toBe(1);
    expect(error.providerName).toBe("test-provider");
    expect(error.errorCode).toBe("1302");
    expect(error.errorMessage).toBe("High concurrency");
    expect(error.rawData).toBe("raw data here");
    expect(error.message).toBe("SSE error response from provider test-provider: High concurrency");
  });

  test("should create error without error code", () => {
    const error = new SSEErrorResponseError(
      1,
      "test-provider",
      undefined,
      "Some error",
      "raw data"
    );

    expect(error.errorCode).toBeUndefined();
    expect(error.errorMessage).toBe("Some error");
  });

  test("getClientSafeMessage should return error message", () => {
    const error = new SSEErrorResponseError(1, "test-provider", "500", "Server error", "raw");

    expect(error.getClientSafeMessage()).toBe("Server error");
  });

  test("getClientSafeMessage should return default message when errorMessage is empty", () => {
    const error = new SSEErrorResponseError(1, "test-provider", "500", "", "raw");

    expect(error.getClientSafeMessage()).toBe("Upstream returned error in SSE stream");
  });

  test("toJSON should return structured metadata", () => {
    const error = new SSEErrorResponseError(
      1,
      "test-provider",
      "1302",
      "High concurrency",
      "raw data"
    );

    expect(error.toJSON()).toEqual({
      type: "sse_error_response",
      provider_id: 1,
      provider_name: "test-provider",
      error_code: "1302",
      error_message: "High concurrency",
      raw_data: "raw data",
    });
  });

  test("toJSON should truncate raw_data to 500 characters", () => {
    const longRawData = "X".repeat(1000);
    const error = new SSEErrorResponseError(1, "test-provider", "500", "Error", longRawData);

    const json = error.toJSON();

    expect(json.raw_data.length).toBe(500);
  });
});

describe("isSSEErrorResponseError type guard", () => {
  test("should return true for SSEErrorResponseError", () => {
    const error = new SSEErrorResponseError(1, "test", "500", "Error", "raw");

    expect(isSSEErrorResponseError(error)).toBe(true);
  });

  test("should return false for regular Error", () => {
    const error = new Error("Regular error");

    expect(isSSEErrorResponseError(error)).toBe(false);
  });

  test("should return false for null", () => {
    expect(isSSEErrorResponseError(null)).toBe(false);
  });

  test("should return false for undefined", () => {
    expect(isSSEErrorResponseError(undefined)).toBe(false);
  });
});

describe("categorizeErrorAsync with SSEErrorResponseError", () => {
  test("should categorize SSEErrorResponseError as PROVIDER_ERROR", async () => {
    const error = new SSEErrorResponseError(
      1,
      "test-provider",
      "1302",
      "High concurrency",
      "raw data"
    );

    const category = await categorizeErrorAsync(error);

    expect(category).toBe(ErrorCategory.PROVIDER_ERROR);
  });
});
