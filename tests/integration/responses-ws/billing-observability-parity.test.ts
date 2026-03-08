import { describe, expect, it } from "vitest";
import { parseServiceTierFromResponseText } from "@/app/v1/_lib/proxy/response-handler";
import { redactResponseBody } from "@/lib/utils/message-redaction";

describe("responses websocket billing and observability parity", () => {
  it("uses actual websocket service tier for pricing", () => {
    const sseText = `event: response.completed\ndata: ${JSON.stringify({
      response: {
        id: "resp_1",
        object: "response",
        model: "gpt-5-codex",
        status: "completed",
        service_tier: "priority",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    })}\n\n`;

    expect(parseServiceTierFromResponseText(sseText)).toBe("priority");
  });

  it("redacts reasoning and tool payloads in trace/log path", () => {
    const redacted = redactResponseBody({
      response: {
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "super secret reasoning" }],
          },
          {
            type: "function_call",
            arguments: '{"apiKey":"super secret value"}',
          },
        ],
      },
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("super secret");
  });
});
