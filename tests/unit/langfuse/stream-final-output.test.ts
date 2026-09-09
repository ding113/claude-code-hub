import { describe, expect, test, vi } from "vitest";
import { finalizeStreamOutputForClient } from "@/lib/langfuse/stream-final-output";

const anthropicStream = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[]}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

const openAiChatStream = [
  'data: {"id":"chat-1","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}',
  "",
  "data: [DONE]",
  "",
].join("\n");

const openAiResponsesStream = [
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"response-1","object":"response","status":"completed","output":[]}}',
  "",
].join("\n");

const geminiStream = [
  'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP"}]}',
  "",
].join("\n");

const geminiCliStream = [
  JSON.stringify({
    response: {
      candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
    },
    sessionId: "session-1",
  }),
].join("\n");

describe("finalizeStreamOutputForClient", () => {
  test.each([
    ["claude", anthropicStream, "message"],
    ["openai", openAiChatStream, "chat.completion"],
    ["response", openAiResponsesStream, "response"],
    ["gemini", geminiStream, "candidates"],
    ["gemini-cli", geminiCliStream, "response"],
  ] as const)("routes %s streaming input to its native finalizer", (format, streamText, key) => {
    const result = finalizeStreamOutputForClient(streamText, format, true);

    expect(result?.kind).toBe("final");
    if (result?.kind !== "final") {
      throw new Error(`Expected a final output for ${format}`);
    }

    if (format === "claude") {
      expect(result.value).toEqual(expect.objectContaining({ type: key }));
    } else if (format === "openai") {
      expect(result.value).toEqual(expect.objectContaining({ object: key }));
    } else if (format === "response") {
      expect(result.value).toEqual(expect.objectContaining({ object: key }));
    } else if (format === "gemini") {
      expect(result.value).toEqual(expect.objectContaining({ [key]: expect.any(Array) }));
    } else {
      expect(result.value).toEqual(expect.objectContaining({ [key]: expect.any(Object) }));
    }
  });

  test("returns absent for non-streaming input without parsing the body", () => {
    expect(finalizeStreamOutputForClient("not a stream", "claude", false)).toBeUndefined();
  });

  test.each([
    ["empty_stream", ""],
    ["malformed_frame", 'event: message\ndata: {"secret":"partial"\n\n'],
    ["accumulator_truncated", 'data: {"type":"message_start"}\n\n\n: [cch_truncated]\n\n'],
  ] as const)("returns a bounded diagnostic for %s stream input", (reason, streamText) => {
    const result = finalizeStreamOutputForClient(streamText, "claude", true);

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason,
    });
    expect(JSON.stringify(result)).not.toContain("data:");
    expect(JSON.stringify(result)).not.toContain("partial");
  });

  test("passes an upstream stream error through as a bounded diagnostic", () => {
    const result = finalizeStreamOutputForClient(
      'event: error\ndata: {"type":"error","message":"upstream secret"}\n\n',
      "response",
      true
    );

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "stream_error",
    });
    expect(JSON.stringify(result)).not.toContain("upstream secret");
    expect(JSON.stringify(result)).not.toContain("data:");
  });

  test("converts an unexpected parser exception into a stream_error diagnostic", async () => {
    vi.resetModules();
    vi.doMock("@/lib/langfuse/stream-final-output-core", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/langfuse/stream-final-output-core")
      >("@/lib/langfuse/stream-final-output-core");
      return {
        ...actual,
        parseStreamFrames: () => {
          throw new Error("unexpected parser failure");
        },
      };
    });

    const { finalizeStreamOutputForClient: mockedDispatcher } = await import(
      "@/lib/langfuse/stream-final-output"
    );
    const result = mockedDispatcher("data: {}\n\n", "claude", true);

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "stream_error",
      eventCount: 0,
    });

    vi.doUnmock("@/lib/langfuse/stream-final-output-core");
    vi.resetModules();
  });
});
