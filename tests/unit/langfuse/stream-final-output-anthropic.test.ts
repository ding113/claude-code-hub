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

describe("Anthropic native block reconstruction regressions", () => {
  function completeBlock(block: unknown, deltas: unknown[] = []): ParsedStreamFrames {
    return frames(
      frame("message_start", { type: "message_start", message: { id: "native", content: [] } }),
      contentBlockStart(0, block),
      ...deltas.map((delta) => contentBlockDelta(0, delta)),
      contentBlockStop(0),
      frame("message_stop", { type: "message_stop" })
    );
  }

  test.each(["tool_use", "server_tool_use", "mcp_tool_use"])(
    "reconstructs incremental input for %s",
    (type) => {
      const block = { type, id: "tool-1", name: "lookup", input: {} };
      const parsed = completeBlock(block, [
        { type: "input_json_delta", partial_json: '{"query":' },
        { type: "input_json_delta", partial_json: '"cats"}' },
      ]);
      expect(expectFinal(finalizeAnthropicStreamOutput(parsed)).value).toMatchObject({
        content: [{ ...block, input: { query: "cats" } }],
      });
      expect(block.input).toEqual({});
    }
  );

  test.each(["tool_use", "server_tool_use", "mcp_tool_use"])(
    "preserves initial input without JSON deltas for %s",
    (type) => {
      for (const input of [{}, { query: "already complete" }]) {
        const block = { type, id: "tool-1", name: "lookup", input };
        expect(
          expectFinal(finalizeAnthropicStreamOutput(completeBlock(block))).value
        ).toMatchObject({
          content: [block],
        });
      }
    }
  );

  test.each([undefined, null, [{ type: "page_location", cited_text: "first" }]])(
    "appends citations to an existing text block with initial citations %j",
    (citations) => {
      const first = {
        type: "web_search_result_location",
        cited_text: "second",
        url: "https://example.com",
      };
      const second = {
        type: "web_search_result_location",
        cited_text: "third",
        url: "https://example.org",
      };
      const block = { type: "text", text: "answer", citations };
      const result = finalizeAnthropicStreamOutput(
        completeBlock(block, [
          { type: "citations_delta", citation: first },
          { type: "citations_delta", citation: second },
        ])
      );
      expect(expectFinal(result).value).toMatchObject({
        content: [
          { type: "text", text: "answer", citations: [...(citations ?? []), first, second] },
        ],
      });
      expect(block.citations).toBe(citations);
    }
  );

  test("reconstructs compaction summaries and keeps the latest encrypted metadata", () => {
    const result = finalizeAnthropicStreamOutput(
      completeBlock({ type: "compaction", content: null, encrypted_content: null }, [
        { type: "compaction_delta", content: "Summary ", encrypted_content: "old" },
        { type: "compaction_delta", content: "complete", encrypted_content: "opaque-final" },
      ])
    );
    expect(expectFinal(result).value).toMatchObject({
      content: [
        { type: "compaction", content: "Summary complete", encrypted_content: "opaque-final" },
      ],
    });
  });

  test("preserves a failed compaction's null content and encrypted metadata", () => {
    const result = finalizeAnthropicStreamOutput(
      completeBlock({ type: "compaction", content: "partial", encrypted_content: "old" }, [
        { type: "compaction_delta", content: null, encrypted_content: null },
      ])
    );
    expect(expectFinal(result).value).toMatchObject({
      content: [{ type: "compaction", content: null, encrypted_content: null }],
    });
  });

  test("accepts compaction deltas without the optional encrypted metadata field", () => {
    const result = finalizeAnthropicStreamOutput(
      completeBlock({ type: "compaction", content: "" }, [
        { type: "compaction_delta", content: "summary" },
      ])
    );
    expect(expectFinal(result).value).toMatchObject({
      content: [{ type: "compaction", content: "summary" }],
    });
  });

  test.each([
    [
      { type: "thinking", thinking: "" },
      { type: "citations_delta", citation: {} },
    ],
    [
      { type: "text", text: "" },
      { type: "citations_delta", citation: "invalid" },
    ],
    [
      { type: "text", text: "" },
      { type: "compaction_delta", content: "summary" },
    ],
    [
      { type: "compaction", content: "" },
      { type: "compaction_delta", content: 42 },
    ],
    [
      { type: "compaction", content: "" },
      { type: "compaction_delta", content: "summary", encrypted_content: 42 },
    ],
  ])("keeps invalid native delta data diagnostic-only", (block, delta) => {
    expect(finalizeAnthropicStreamOutput(completeBlock(block, [delta]))).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
    });
  });

  test("keeps reconstructed compaction output within the serialized budget", () => {
    const result = finalizeAnthropicStreamOutput(
      completeBlock({ type: "compaction", content: "" }, [
        { type: "compaction_delta", content: "x".repeat(1024 * 1024) },
      ])
    );
    expect(result).toMatchObject({ kind: "final_output_unavailable", reason: "over_budget" });
  });
});
