import { describe, expect, test } from "vitest";
import type {
  ParsedStreamFrames,
  StreamFrame,
  StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";
import { finalizeAnthropicStreamOutput } from "@/lib/langfuse/stream-final-output-anthropic";

function frame(event: string, data: unknown): StreamFrame {
  return { framing: "sse", event, data };
}

function frames(...items: StreamFrame[]): ParsedStreamFrames {
  return { kind: "frames", framing: "sse", frames: items };
}

function contentBlockStart(index: number, contentBlock: unknown): StreamFrame {
  return frame("content_block_start", {
    type: "content_block_start",
    index,
    content_block: contentBlock,
  });
}

function contentBlockDelta(index: unknown, delta: unknown): StreamFrame {
  return frame("content_block_delta", { type: "content_block_delta", index, delta });
}

function contentBlockStop(index: number): StreamFrame {
  return frame("content_block_stop", { type: "content_block_stop", index });
}

function expectFinal(result: StreamFinalOutput): {
  readonly kind: "final";
  readonly value: unknown;
} {
  expect(result.kind).toBe("final");
  if (result.kind !== "final") {
    throw new Error("Expected final output");
  }
  return result;
}

describe("finalizeAnthropicStreamOutput", () => {
  test("reconstructs text, thinking, signature, tool input, and final usage", () => {
    const result = expectFinal(
      finalizeAnthropicStreamOutput(
        frames(
          frame("message_start", {
            type: "message_start",
            message: {
              id: "msg_123",
              type: "message",
              role: "assistant",
              model: "claude-test",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 4 },
              vendor_message_field: "preserve-me",
            },
          }),
          contentBlockStart(0, { type: "text", text: "", vendor_block_field: "keep-me" }),
          contentBlockDelta(0, { type: "text_delta", text: "Hello" }),
          contentBlockDelta(0, { type: "text_delta", text: " world" }),
          contentBlockStart(1, { type: "thinking", thinking: "" }),
          contentBlockDelta(1, { type: "thinking_delta", thinking: "reason" }),
          contentBlockDelta(1, { type: "thinking_delta", thinking: "ing" }),
          contentBlockDelta(1, { type: "signature_delta", signature: "sig-part" }),
          contentBlockStart(2, {
            type: "tool_use",
            id: "tool_123",
            name: "search",
            input: {},
            vendor_tool_field: 7,
          }),
          contentBlockDelta(2, { type: "input_json_delta", partial_json: '{"query":"ca' }),
          contentBlockDelta(2, { type: "input_json_delta", partial_json: 'ts","limit":' }),
          contentBlockDelta(2, { type: "input_json_delta", partial_json: "2}" }),
          contentBlockStop(0),
          contentBlockStop(1),
          contentBlockStop(2),
          frame("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: { output_tokens: 12 },
          }),
          frame("message_stop", { type: "message_stop" })
        )
      )
    );

    expect(result.value).toEqual({
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [
        { type: "text", text: "Hello world", vendor_block_field: "keep-me" },
        { type: "thinking", thinking: "reasoning", signature: "sig-part" },
        {
          type: "tool_use",
          id: "tool_123",
          name: "search",
          input: { query: "cats", limit: 2 },
          vendor_tool_field: 7,
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 12 },
      vendor_message_field: "preserve-me",
    });
  });

  test("orders completed blocks by event index rather than arrival order", () => {
    const result = expectFinal(
      finalizeAnthropicStreamOutput(
        frames(
          frame("message_start", {
            type: "message_start",
            message: { id: "msg_order", type: "message", content: [] },
          }),
          contentBlockStart(2, { type: "text", text: "" }),
          contentBlockDelta(2, { type: "text_delta", text: "third" }),
          contentBlockStart(0, { type: "text", text: "" }),
          contentBlockDelta(0, { type: "text_delta", text: "first" }),
          contentBlockStart(1, { type: "text", text: "" }),
          contentBlockDelta(1, { type: "text_delta", text: "second" }),
          contentBlockStop(2),
          contentBlockStop(0),
          contentBlockStop(1),
          frame("message_stop", { type: "message_stop" })
        )
      )
    );

    expect(result.value).toMatchObject({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        { type: "text", text: "third" },
      ],
    });
  });

  test("returns malformed_frame when tool JSON is incomplete at block stop", () => {
    const result = finalizeAnthropicStreamOutput(
      frames(
        frame("message_start", {
          type: "message_start",
          message: { id: "msg_bad_tool", type: "message", content: [] },
        }),
        contentBlockStart(0, { type: "tool_use", id: "tool_bad", name: "search", input: {} }),
        contentBlockDelta(0, { type: "input_json_delta", partial_json: '{"secret":"partial' }),
        contentBlockStop(0),
        frame("message_stop", { type: "message_stop" })
      )
    );

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
    });
    expect(JSON.stringify(result)).not.toContain("partial");
    expect(JSON.stringify(result)).not.toContain("data:");
  });

  test("returns no_terminal_event when message_stop is absent", () => {
    const result = finalizeAnthropicStreamOutput(
      frames(
        frame("message_start", {
          type: "message_start",
          message: { id: "msg_incomplete", type: "message", content: [] },
        }),
        contentBlockStart(0, { type: "text", text: "" }),
        contentBlockDelta(0, { type: "text_delta", text: "unfinished" })
      )
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 3,
      framing: "sse",
    });
  });

  test("returns a bounded malformed diagnostic for malformed event data", () => {
    const result = finalizeAnthropicStreamOutput(
      frames(
        frame("message_start", {
          type: "message_start",
          message: { secret: "model-output" },
        }),
        contentBlockDelta("not-an-index", { type: "text_delta", text: "hidden" })
      )
    );

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
      eventCount: 2,
      framing: "sse",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("model-output");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("data:");
  });

  test("returns malformed_frame for an unknown content block delta type", () => {
    const result = finalizeAnthropicStreamOutput(
      frames(
        frame("message_start", {
          type: "message_start",
          message: { id: "msg_unknown_delta", type: "message", content: [] },
        }),
        contentBlockStart(0, { type: "text", text: "" }),
        contentBlockDelta(0, { type: "unknown_delta", text: "hidden" })
      )
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
      eventCount: 3,
      framing: "sse",
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("ignores ping events while reconstructing a message", () => {
    const result = expectFinal(
      finalizeAnthropicStreamOutput(
        frames(
          frame("message_start", {
            type: "message_start",
            message: { id: "msg_ping", type: "message", content: [] },
          }),
          frame("ping", { type: "ping" }),
          contentBlockStart(0, { type: "text", text: "" }),
          contentBlockDelta(0, { type: "text_delta", text: "still complete" }),
          contentBlockStop(0),
          frame("message_stop", { type: "message_stop" })
        )
      )
    );

    expect(result.value).toMatchObject({
      id: "msg_ping",
      content: [{ type: "text", text: "still complete" }],
    });
  });
});
