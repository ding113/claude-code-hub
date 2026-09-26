import { describe, expect, test } from "vitest";
import {
  finalizeStreamOutput,
  parseStreamFrames,
  type ParseStreamFramesResult,
  type ParsedStreamFrames,
} from "@/lib/langfuse/stream-final-output-core";

function expectFrames(result: ParseStreamFramesResult): ParsedStreamFrames {
  expect(result.kind).toBe("frames");
  if (result.kind !== "frames") {
    throw new Error("Expected parsed stream frames");
  }
  return result;
}

describe("parseStreamFrames", () => {
  test("parses ordered SSE events with parsed JSON data", () => {
    const streamText = [
      "event: message_start",
      'data: {"type":"message_start"}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","text":"Hello"}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");

    const result = expectFrames(parseStreamFrames(streamText));

    expect(result).toEqual({
      kind: "frames",
      framing: "sse",
      frames: [
        {
          framing: "sse",
          event: "message_start",
          data: { type: "message_start" },
        },
        {
          framing: "sse",
          event: "content_block_delta",
          data: { type: "content_block_delta", text: "Hello" },
        },
        {
          framing: "sse",
          event: "message_stop",
          data: { type: "message_stop" },
        },
      ],
    });
  });

  test("preserves the SSE completion sentinel for protocol parsers", () => {
    const result = expectFrames(parseStreamFrames('data: {"type":"done"}\n\ndata: [DONE]\n\n'));

    expect(result.frames).toEqual([
      {
        framing: "sse",
        event: "message",
        data: { type: "done" },
      },
      {
        framing: "sse",
        event: "message",
        data: "[DONE]",
      },
    ]);
  });

  test("parses ordered NDJSON object records", () => {
    const streamText = [
      '{"type":"response.output_text.delta","text":"Hello"}',
      '{"type":"response.completed","status":"completed"}',
    ].join("\n");

    const result = expectFrames(parseStreamFrames(streamText));

    expect(result.framing).toBe("ndjson");
    expect(result.frames).toEqual([
      {
        framing: "ndjson",
        event: null,
        data: { type: "response.output_text.delta", text: "Hello" },
      },
      {
        framing: "ndjson",
        event: null,
        data: { type: "response.completed", status: "completed" },
      },
    ]);
  });

  test("parses a JSON array as ordered records", () => {
    const result = expectFrames(
      parseStreamFrames('[{"type":"candidate","text":"Hello"},{"type":"done"}]')
    );

    expect(result.framing).toBe("json-array");
    expect(result.frames).toEqual([
      {
        framing: "json-array",
        event: null,
        data: { type: "candidate", text: "Hello" },
      },
      {
        framing: "json-array",
        event: null,
        data: { type: "done" },
      },
    ]);
  });

  test("returns accumulator_truncated before parsing an otherwise valid stream", () => {
    const streamText =
      'data: {"type":"message_start"}\n\n\n: [cch_truncated]\n\ndata: {"type":"message_stop"}\n\n';

    const result = parseStreamFrames(streamText);

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "accumulator_truncated",
      eventCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain("message_start");
  });

  test("returns malformed_frame for malformed JSON in an SSE data line", () => {
    const streamText = 'event: message\ndata: {"secret":"model-output"\n\n';

    const result = parseStreamFrames(streamText);

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
      eventCount: 1,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("data:");
    expect(serialized).not.toContain("model-output");
  });

  test("returns malformed_frame for malformed JSON in NDJSON", () => {
    const streamText = '{"type":"valid"}\n{"secret":"model-output"';

    const result = parseStreamFrames(streamText);

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
      eventCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("model-output");
  });

  test("returns empty_stream for empty input", () => {
    expect(parseStreamFrames("\n  \n")).toEqual({
      kind: "final_output_unavailable",
      reason: "empty_stream",
      eventCount: 0,
    });
  });

  test("returns unsupported_framing for non-framed text", () => {
    expect(parseStreamFrames("plain model output")).toEqual({
      kind: "final_output_unavailable",
      reason: "unsupported_framing",
      eventCount: 0,
    });
  });
});

describe("finalizeStreamOutput", () => {
  test("returns a native final output when its JSON representation is within budget", () => {
    const value = { type: "message", content: [{ type: "text", text: "Hello" }] };

    expect(finalizeStreamOutput(value, { eventCount: 2, status: 200 })).toEqual({
      kind: "final",
      value,
    });
  });

  test("returns over_budget without partial output or raw body text", () => {
    const rawModelOutput = "model-output-".repeat(100_000);
    const value = { content: rawModelOutput };

    const result = finalizeStreamOutput(value, { eventCount: 42, status: 200 });

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "over_budget",
      status: 200,
      eventCount: 42,
    });
    if (result.kind !== "final_output_unavailable") {
      throw new Error("Expected over-budget diagnostic");
    }
    expect(result.serializedBytes).toBeGreaterThan(result.maxSerializedBytes);
    expect(JSON.stringify(result)).not.toContain(rawModelOutput);
    expect(JSON.stringify(result)).not.toContain("model-output-");
  });
});
