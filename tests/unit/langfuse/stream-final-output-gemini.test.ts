import { describe, expect, test } from "vitest";
import {
  parseStreamFrames,
  type ParseStreamFramesResult,
  type ParsedStreamFrames,
} from "@/lib/langfuse/stream-final-output-core";
import { finalizeGeminiStreamOutput } from "@/lib/langfuse/stream-final-output-gemini";

function expectFrames(result: ParseStreamFramesResult): ParsedStreamFrames {
  expect(result.kind).toBe("frames");
  if (result.kind !== "frames") {
    throw new Error("Expected parsed stream frames");
  }
  return result;
}

function expectFinalValue(result: ReturnType<typeof finalizeGeminiStreamOutput>): unknown {
  expect(result.kind).toBe("final");
  if (result.kind !== "final") {
    throw new Error("Expected a final Gemini response");
  }
  return result.value;
}

describe("finalizeGeminiStreamOutput", () => {
  test("folds direct Gemini SSE candidates, text, function parts, and final metadata", () => {
    const streamText = [
      'data: {"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"Hel"}]}},{"index":1,"content":{"role":"model","parts":[{"functionCall":{"name":"lookup","args":{"query":"weather"}}}]}}],"modelVersion":"gemini-2.5-flash","promptFeedback":{"blockReason":"BLOCKED"}}',
      "",
      'data: {"candidates":[{"index":1,"content":{"parts":[{"functionResponse":{"name":"lookup","response":{"temperature":21}}}]},"finishReason":"STOP","safetyRatings":[{"category":"HARM_CATEGORY_HARASSMENT","probability":"NEGLIGIBLE"}]},{"index":0,"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP","citationMetadata":{"citationSources":[{"startIndex":0,"endIndex":5,"uri":"https://example.test/source","license":"CC"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":6,"totalTokenCount":10},"responseId":"response-2"}',
      "",
    ].join("\n");

    const result = finalizeGeminiStreamOutput(expectFrames(parseStreamFrames(streamText)));

    expect(result).toEqual({
      kind: "final",
      value: {
        candidates: [
          {
            index: 0,
            content: {
              role: "model",
              parts: [{ text: "Hello" }],
            },
            finishReason: "STOP",
            citationMetadata: {
              citationSources: [
                {
                  startIndex: 0,
                  endIndex: 5,
                  uri: "https://example.test/source",
                  license: "CC",
                },
              ],
            },
          },
          {
            index: 1,
            content: {
              role: "model",
              parts: [
                { functionCall: { name: "lookup", args: { query: "weather" } } },
                {
                  functionResponse: {
                    name: "lookup",
                    response: { temperature: 21 },
                  },
                },
              ],
            },
            finishReason: "STOP",
            safetyRatings: [
              {
                category: "HARM_CATEGORY_HARASSMENT",
                probability: "NEGLIGIBLE",
              },
            ],
          },
        ],
        modelVersion: "gemini-2.5-flash",
        promptFeedback: { blockReason: "BLOCKED" },
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 6,
          totalTokenCount: 10,
        },
        responseId: "response-2",
      },
    });
  });

  test("folds direct Gemini NDJSON by candidate position and keeps latest metadata", () => {
    const streamText = [
      JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "A" }] } }],
        modelVersion: "gemini-old",
      }),
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "B" }] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 2,
          totalTokenCount: 3,
        },
      }),
      JSON.stringify({ modelVersion: "gemini-latest", responseId: "response-3" }),
    ].join("\n");

    const result = finalizeGeminiStreamOutput(expectFrames(parseStreamFrames(streamText)));

    expect(expectFinalValue(result)).toEqual({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "AB" }],
          },
          finishReason: "STOP",
        },
      ],
      modelVersion: "gemini-latest",
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 2,
        totalTokenCount: 3,
      },
      responseId: "response-3",
    });
  });

  test("folds JSON-array frames into a native Gemini response", () => {
    const streamText = JSON.stringify([
      {
        candidates: [
          {
            index: 0,
            content: { role: "model", parts: [{ text: "array" }] },
          },
        ],
      },
      {
        candidates: [{ index: 0, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 5,
          totalTokenCount: 7,
        },
      },
    ]);

    const result = finalizeGeminiStreamOutput(expectFrames(parseStreamFrames(streamText)));

    expect(expectFinalValue(result)).toEqual({
      candidates: [
        {
          index: 0,
          content: {
            role: "model",
            parts: [{ text: "array" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 5,
        totalTokenCount: 7,
      },
    });
  });

  test("preserves the Gemini CLI response envelope while folding its inner response", () => {
    const streamText = [
      JSON.stringify({
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "cli " }] },
            },
          ],
          modelVersion: "gemini-cli-model",
        },
        sessionId: "session-1",
      }),
      JSON.stringify({
        response: {
          candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 4,
            totalTokenCount: 7,
          },
        },
        traceId: "trace-2",
      }),
    ].join("\n");

    const result = finalizeGeminiStreamOutput(expectFrames(parseStreamFrames(streamText)));

    expect(expectFinalValue(result)).toEqual({
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "cli answer" }],
            },
            finishReason: "STOP",
          },
        ],
        modelVersion: "gemini-cli-model",
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 4,
          totalTokenCount: 7,
        },
      },
      sessionId: "session-1",
      traceId: "trace-2",
    });
  });

  test("returns empty_stream for an empty parsed frame list", () => {
    const result = finalizeGeminiStreamOutput({
      kind: "frames",
      framing: "ndjson",
      frames: [],
    });

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "empty_stream",
      eventCount: 0,
      framing: "ndjson",
    });
  });

  test("returns no_terminal_event without retaining incomplete text", () => {
    const streamText = JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "partial-secret" }] } }],
    });
    const result = finalizeGeminiStreamOutput(expectFrames(parseStreamFrames(streamText)));

    expect(result).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 1,
      framing: "ndjson",
    });
    expect(JSON.stringify(result)).not.toContain("partial-secret");
  });

  test("core malformed NDJSON diagnostics contain no raw NDJSON payload", () => {
    const result = parseStreamFrames(
      `${JSON.stringify({ candidates: [{ content: { parts: [{ text: "safe-secret" }] } }] })}\n{"secret":"partial`
    );

    expect(result).toMatchObject({
      kind: "final_output_unavailable",
      reason: "malformed_frame",
      framing: "ndjson",
    });
    expect(JSON.stringify(result)).not.toContain("safe-secret");
    expect(JSON.stringify(result)).not.toContain("partial");
  });
});
