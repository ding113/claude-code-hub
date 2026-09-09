import { describe, expect, test } from "vitest";
import type {
  ParsedStreamFrames,
  StreamFinalOutput,
} from "@/lib/langfuse/stream-final-output-core";
import {
  finalizeOpenAIChatStream,
  finalizeOpenAIResponsesStream,
} from "@/lib/langfuse/stream-final-output-openai";

type FrameRecord = {
  readonly event?: string;
  readonly data: unknown;
};

function frames(records: readonly FrameRecord[]): ParsedStreamFrames {
  return {
    kind: "frames",
    framing: "sse",
    frames: records.map((record) => ({
      framing: "sse",
      event: record.event ?? "message",
      data: record.data,
    })),
  };
}

function finalValue(result: StreamFinalOutput): Record<string, unknown> {
  expect(result.kind).toBe("final");
  if (result.kind !== "final") {
    throw new Error("Expected a final output");
  }
  if (!isRecord(result.value)) {
    throw new Error("Expected an object final output");
  }
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("finalizeOpenAIChatStream", () => {
  test("returns no_terminal_event for a DONE-only stream", () => {
    const result = finalizeOpenAIChatStream(frames([{ data: "[DONE]" }]));

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 1,
      framing: "sse",
    });
  });

  test("returns no_terminal_event for a partial stream without DONE or finish reasons", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-partial",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "unfinished" },
                finish_reason: null,
              },
            ],
          },
        },
      ])
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 1,
      framing: "sse",
    });
  });

  test("returns no_terminal_event when DONE follows a choice with a null finish reason", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-truncated",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "truncated" },
                finish_reason: null,
              },
            ],
          },
        },
        { data: "[DONE]" },
      ])
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 2,
      framing: "sse",
    });
  });

  test("finalizes all choices with non-null finish reasons without DONE", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-finished",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "first" },
                finish_reason: "stop",
              },
              {
                index: 1,
                delta: { role: "assistant", content: "second" },
                finish_reason: "length",
              },
            ],
          },
        },
      ])
    );

    expect(finalValue(result)).toMatchObject({
      id: "chatcmpl-finished",
      choices: [
        { index: 0, message: { content: "first" }, finish_reason: "stop" },
        { index: 1, message: { content: "second" }, finish_reason: "length" },
      ],
    });
  });

  test("concatenates reasoning-only deltas into one native chat completion", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-reasoning",
            object: "chat.completion.chunk",
            created: 100,
            model: "gpt-test",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", reasoning_content: "First " },
                finish_reason: null,
              },
            ],
          },
        },
        {
          data: {
            id: "chatcmpl-reasoning",
            object: "chat.completion.chunk",
            created: 100,
            model: "gpt-test",
            choices: [
              {
                index: 0,
                delta: { reasoning_content: "second" },
                finish_reason: null,
              },
            ],
          },
        },
        {
          data: {
            id: "chatcmpl-reasoning",
            object: "chat.completion.chunk",
            created: 100,
            model: "gpt-test",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
        },
        { data: "[DONE]" },
      ])
    );

    expect(finalValue(result)).toEqual({
      id: "chatcmpl-reasoning",
      object: "chat.completion",
      created: 100,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", reasoning_content: "First second" },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
    });
  });

  test("folds choices by index and retains first role, id, and names", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-multi",
            object: "chat.completion.chunk",
            created: 101,
            model: "gpt-test",
            choices: [
              {
                index: 1,
                delta: { role: "assistant", id: "message-1", name: "first-name", content: "B" },
                finish_reason: null,
              },
              {
                index: 0,
                delta: { role: "assistant", id: "message-0", name: "zero-name", content: "A" },
                finish_reason: null,
              },
            ],
          },
        },
        {
          data: {
            id: "chatcmpl-multi",
            object: "chat.completion.chunk",
            created: 101,
            model: "gpt-test",
            choices: [
              {
                index: 0,
                delta: { id: "later-0", name: "later-name", content: "0" },
                finish_reason: "stop",
              },
              {
                index: 1,
                delta: { id: "later-1", content: "1" },
                finish_reason: "length",
              },
            ],
          },
        },
      ])
    );

    expect(finalValue(result)).toMatchObject({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            id: "message-0",
            name: "zero-name",
            content: "A0",
          },
          finish_reason: "stop",
        },
        {
          index: 1,
          message: {
            role: "assistant",
            id: "message-1",
            name: "first-name",
            content: "B1",
          },
          finish_reason: "length",
        },
      ],
    });
  });

  test("concatenates indexed tool-call and legacy function arguments", () => {
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-tools",
            object: "chat.completion.chunk",
            created: 102,
            model: "gpt-tools",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  function_call: { name: "legacy", arguments: '{"a":' },
                  tool_calls: [
                    {
                      index: 1,
                      id: "call-1",
                      type: "function",
                      function: { name: "second", arguments: '{"b":' },
                    },
                    {
                      index: 0,
                      id: "call-0",
                      type: "function",
                      function: { name: "first", arguments: '{"c":' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
        },
        {
          data: {
            id: "chatcmpl-tools",
            object: "chat.completion.chunk",
            created: 102,
            model: "gpt-tools",
            choices: [
              {
                index: 0,
                delta: {
                  function_call: { name: "later", arguments: "1}" },
                  tool_calls: [
                    {
                      index: 1,
                      id: null,
                      type: null,
                      function: { name: null, arguments: "2}" },
                    },
                    {
                      index: 0,
                      function: { arguments: "3}" },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        },
      ])
    );

    expect(finalValue(result)).toMatchObject({
      choices: [
        {
          message: {
            function_call: { name: "legacy", arguments: '{"a":1}' },
            tool_calls: [
              {
                index: 0,
                id: "call-0",
                type: "function",
                function: { name: "first", arguments: '{"c":3}' },
              },
              {
                index: 1,
                id: "call-1",
                type: "function",
                function: { name: "second", arguments: '{"b":2}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  });

  test("does not let null deltas overwrite accumulated values and applies final metadata", () => {
    const usage = { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 };
    const logprobs = { content: [{ token: "hello" }] };
    const result = finalizeOpenAIChatStream(
      frames([
        {
          data: {
            id: "chatcmpl-meta",
            object: "chat.completion.chunk",
            created: 103,
            model: "gpt-meta",
            system_fingerprint: "fp-1",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hello", reasoning_content: "think" },
                finish_reason: null,
                logprobs: null,
              },
            ],
          },
        },
        {
          data: {
            id: null,
            object: "chat.completion.chunk",
            created: null,
            model: null,
            system_fingerprint: null,
            choices: [
              {
                index: 0,
                delta: { role: null, content: null, reasoning_content: null },
                finish_reason: "stop",
                logprobs,
              },
            ],
            usage,
          },
        },
      ])
    );

    expect(finalValue(result)).toEqual({
      id: "chatcmpl-meta",
      object: "chat.completion",
      created: 103,
      model: "gpt-meta",
      system_fingerprint: "fp-1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello", reasoning_content: "think" },
          finish_reason: "stop",
          logprobs,
        },
      ],
      usage,
    });
  });
});

describe("finalizeOpenAIResponsesStream", () => {
  test("returns the native response from response.completed", () => {
    const response = {
      id: "resp-complete",
      object: "response",
      status: "completed",
      output: [],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    };

    const result = finalizeOpenAIResponsesStream(
      frames([
        { event: "response.created", data: { type: "response.created" } },
        { event: "response.completed", data: { type: "response.completed", response } },
      ])
    );

    expect(finalValue(result)).toEqual(response);
  });

  test("retains an incomplete response and its incomplete details", () => {
    const response = {
      id: "resp-incomplete",
      object: "response",
      status: "incomplete",
      output: [],
    };
    const incompleteDetails = { reason: "max_output_tokens" };

    const result = finalizeOpenAIResponsesStream(
      frames([
        {
          event: "response.incomplete",
          data: {
            type: "response.incomplete",
            response,
            incomplete_details: incompleteDetails,
          },
        },
      ])
    );

    expect(finalValue(result)).toEqual({ ...response, incomplete_details: incompleteDetails });
  });

  test("returns a stream_error diagnostic for response.failed", () => {
    const result = finalizeOpenAIResponsesStream(
      frames([
        {
          event: "response.failed",
          data: { type: "response.failed", response: { status: "failed" } },
        },
      ])
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "stream_error",
      eventCount: 1,
      framing: "sse",
    });
  });

  test("returns a stream_error diagnostic for an error event", () => {
    const result = finalizeOpenAIResponsesStream(
      frames([{ event: "error", data: { type: "error", message: "upstream failed" } }])
    );

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "stream_error",
      eventCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("upstream failed");
  });

  test("returns no_terminal_event when no terminal response event exists", () => {
    const result = finalizeOpenAIResponsesStream(
      frames([
        { event: "response.output_text.delta", data: { type: "response.output_text.delta" } },
      ])
    );

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 1,
      framing: "sse",
    });
  });
});
