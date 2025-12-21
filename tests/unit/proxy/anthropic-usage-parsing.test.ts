import { describe, expect, test } from "vitest";
import { parseUsageFromResponseText } from "@/app/v1/_lib/proxy/response-handler";

function buildSse(events: Array<{ event: string; data: unknown }>): string {
  return events
    .flatMap(({ event, data }) => [`event: ${event}`, `data: ${JSON.stringify(data)}`, ""])
    .join("\n");
}

describe("parseUsageFromResponseText (Anthropic/Claude SSE usage)", () => {
  test("prefers message_delta and falls back to message_start for missing fields", () => {
    const sse = buildSse([
      {
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 12,
              cache_creation_input_tokens: 1641,
              cache_read_input_tokens: 171876,
              output_tokens: 1,
              cache_creation: { ephemeral_1h_input_tokens: 1641 },
            },
          },
        },
      },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: {
            input_tokens: 9,
            cache_creation_input_tokens: 458843,
            cache_read_input_tokens: 14999,
            output_tokens: 2273,
          },
        },
      },
    ]);

    const { usageMetrics, usageRecord } = parseUsageFromResponseText(sse, "anthropic");

    expect(usageRecord).not.toBeNull();
    expect(usageMetrics).toMatchObject({
      input_tokens: 9,
      output_tokens: 2273,
      cache_creation_input_tokens: 458843,
      cache_read_input_tokens: 14999,
      cache_creation_1h_input_tokens: 1641,
      cache_ttl: "1h",
    });
  });

  test("falls back to message_start when message_delta only provides output_tokens", () => {
    const sse = buildSse([
      {
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 12,
              cache_creation_input_tokens: 1641,
              cache_read_input_tokens: 171876,
              output_tokens: 1,
              cache_creation: { ephemeral_1h_input_tokens: 1641 },
            },
          },
        },
      },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 2273 },
        },
      },
    ]);

    const { usageMetrics, usageRecord } = parseUsageFromResponseText(sse, "anthropic");

    expect(usageRecord).not.toBeNull();
    expect(usageMetrics).toMatchObject({
      input_tokens: 12,
      output_tokens: 2273,
      cache_creation_input_tokens: 1641,
      cache_read_input_tokens: 171876,
      cache_creation_1h_input_tokens: 1641,
      cache_ttl: "1h",
    });
  });

  test("handles message_delta-only streams", () => {
    const sse = buildSse([
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: {
            input_tokens: 9,
            cache_creation_input_tokens: 458843,
            cache_read_input_tokens: 14999,
            output_tokens: 2273,
          },
        },
      },
    ]);

    const { usageMetrics, usageRecord } = parseUsageFromResponseText(sse, "anthropic");

    expect(usageRecord).not.toBeNull();
    expect(usageMetrics).toMatchObject({
      input_tokens: 9,
      output_tokens: 2273,
      cache_creation_input_tokens: 458843,
      cache_read_input_tokens: 14999,
    });
  });
});
