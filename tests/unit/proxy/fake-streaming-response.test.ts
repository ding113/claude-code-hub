import { describe, expect, test } from "vitest";
import {
  emitFinalNonStream,
  emitFinalStream,
  emitStreamError,
} from "@/app/v1/_lib/proxy/fake-streaming/emitters";
import type { ProtocolFamily } from "@/app/v1/_lib/proxy/fake-streaming/response-validator";

function parseSseEvents(body: string): Array<{ event: string | null; data: string }> {
  const events: Array<{ event: string | null; data: string }> = [];
  const dataLines: string[] = [];
  let currentEvent: string | null = null;

  const flush = () => {
    if (dataLines.length === 0) {
      currentEvent = null;
      return;
    }
    events.push({ event: currentEvent, data: dataLines.join("\n") });
    dataLines.length = 0;
    currentEvent = null;
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
  }
  flush();
  return events;
}

describe("emitFinalNonStream", () => {
  test.each<ProtocolFamily>([
    "anthropic",
    "openai-chat",
    "openai-responses",
    "gemini",
  ])("%s: returns the validated final body verbatim", (family) => {
    const body = JSON.stringify({ id: "x", model: "m", content: [{ type: "text", text: "hi" }] });
    expect(emitFinalNonStream({ family, finalBody: body })).toBe(body);
  });
});

describe("emitFinalStream — anthropic", () => {
  test("emits message_start, content_block_*, message_delta, message_stop for text content", () => {
    const finalBody = JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-3-5-sonnet-latest",
      content: [{ type: "text", text: "hello world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const sse = emitFinalStream({ family: "anthropic", finalBody });
    const events = parseSseEvents(sse);
    const eventNames = events.map((e) => e.event).filter((name) => name !== null);

    expect(eventNames[0]).toBe("message_start");
    expect(eventNames).toContain("content_block_start");
    expect(eventNames).toContain("content_block_delta");
    expect(eventNames).toContain("content_block_stop");
    expect(eventNames).toContain("message_delta");
    expect(eventNames[eventNames.length - 1]).toBe("message_stop");

    // Find the text delta and verify it contains the full text
    const textDelta = events.find((e) => e.event === "content_block_delta");
    expect(textDelta).toBeTruthy();
    if (textDelta) {
      const parsed = JSON.parse(textDelta.data);
      expect(parsed.delta.text).toBe("hello world");
    }
  });

  test("emits tool_use as start(empty input) + input_json_delta + stop", () => {
    const finalBody = JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-3-5",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "search",
          input: { query: "x" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const sse = emitFinalStream({ family: "anthropic", finalBody });
    const events = parseSseEvents(sse);

    // The Anthropic SDK only populates tool_use input from input_json_delta
    // events; data inlined into content_block_start is silently ignored.
    const blockStart = events.find((e) => e.event === "content_block_start");
    expect(blockStart).toBeTruthy();
    if (blockStart) {
      const parsed = JSON.parse(blockStart.data);
      expect(parsed.content_block.type).toBe("tool_use");
      expect(parsed.content_block.id).toBe("tu_1");
      expect(parsed.content_block.name).toBe("search");
      expect(parsed.content_block.input).toEqual({});
    }

    const inputJsonDelta = events.find(
      (e) =>
        e.event === "content_block_delta" && JSON.parse(e.data).delta?.type === "input_json_delta"
    );
    expect(inputJsonDelta).toBeTruthy();
    if (inputJsonDelta) {
      const parsed = JSON.parse(inputJsonDelta.data);
      expect(parsed.delta.partial_json).toBe(JSON.stringify({ query: "x" }));
    }

    // No text delta for tool_use
    const textDeltas = events.filter(
      (e) => e.event === "content_block_delta" && JSON.parse(e.data).delta?.type === "text_delta"
    );
    expect(textDeltas.length).toBe(0);

    const blockStop = events.find((e) => e.event === "content_block_stop");
    expect(blockStop).toBeTruthy();
  });

  test("tool_use with missing/null input still emits a delta with empty object JSON", () => {
    const finalBody = JSON.stringify({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "claude-3-5",
      content: [{ type: "tool_use", id: "tu_2", name: "noop" }],
      stop_reason: "tool_use",
    });
    const sse = emitFinalStream({ family: "anthropic", finalBody });
    const events = parseSseEvents(sse);
    const inputJsonDelta = events.find(
      (e) =>
        e.event === "content_block_delta" && JSON.parse(e.data).delta?.type === "input_json_delta"
    );
    expect(inputJsonDelta).toBeTruthy();
    if (inputJsonDelta) {
      const parsed = JSON.parse(inputJsonDelta.data);
      expect(parsed.delta.partial_json).toBe("{}");
    }
  });
});

describe("emitFinalStream — openai-chat", () => {
  test("emits chat.completion.chunk delta, finish_reason, [DONE]", () => {
    const finalBody = JSON.stringify({
      id: "chatcmpl_1",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o-mini",
      choices: [
        {
          message: { role: "assistant", content: "hi there" },
          index: 0,
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });

    const sse = emitFinalStream({ family: "openai-chat", finalBody });
    const events = parseSseEvents(sse);

    expect(events.length).toBeGreaterThan(0);

    // First event must be a chunk with role
    const firstChunk = JSON.parse(events[0].data);
    expect(firstChunk.object).toBe("chat.completion.chunk");
    expect(firstChunk.choices[0].delta.role).toBe("assistant");

    // There must be a chunk with delta.content carrying the text
    const textChunkEvents = events
      .filter((e) => e.data !== "[DONE]")
      .map((e) => JSON.parse(e.data));
    const textJoined = textChunkEvents
      .flatMap(
        (c) =>
          c.choices?.flatMap((ch: { delta?: { content?: string } }) => ch.delta?.content ?? "") ??
          []
      )
      .join("");
    expect(textJoined).toContain("hi there");

    // Finish reason chunk
    const finishChunk = textChunkEvents.find((c) =>
      c.choices?.some((ch: { finish_reason?: string }) => ch.finish_reason === "stop")
    );
    expect(finishChunk).toBeTruthy();

    // Final [DONE]
    expect(events[events.length - 1].data).toBe("[DONE]");
  });
});

describe("emitFinalStream — openai-responses", () => {
  test("emits response.created and response.completed events", () => {
    const finalBody = JSON.stringify({
      id: "resp_1",
      object: "response",
      created: 1700000000,
      model: "gpt-4o-mini",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi" }],
        },
      ],
    });

    const sse = emitFinalStream({ family: "openai-responses", finalBody });
    const events = parseSseEvents(sse);
    const eventNames = events.map((e) => e.event).filter((name) => name !== null);

    expect(eventNames[0]).toBe("response.created");
    expect(eventNames).toContain("response.completed");

    const completed = events.find((e) => e.event === "response.completed");
    expect(completed).toBeTruthy();
    if (completed) {
      const parsed = JSON.parse(completed.data);
      expect(parsed.response.output[0].content[0].text).toBe("hi");
    }
  });
});

describe("emitFinalStream — gemini", () => {
  test("emits a single data frame containing the full candidates body", () => {
    const finalObj = {
      candidates: [
        {
          content: { parts: [{ text: "hi" }] },
          finishReason: "STOP",
          index: 0,
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      modelVersion: "gemini-3-pro",
    };
    const sse = emitFinalStream({ family: "gemini", finalBody: JSON.stringify(finalObj) });
    const events = parseSseEvents(sse);

    expect(events.length).toBe(1);
    const parsed = JSON.parse(events[0].data);
    expect(parsed).toEqual(finalObj);
  });

  test("preserves multi-line (pretty-printed) JSON across SSE data lines", () => {
    const finalObj = {
      candidates: [{ content: { parts: [{ text: "multi\nline" }] }, finishReason: "STOP" }],
      modelVersion: "gemini-3-pro",
    };
    // Pretty-print with 2-space indent so the body contains real newlines.
    const finalBody = JSON.stringify(finalObj, null, 2);
    const sse = emitFinalStream({ family: "gemini", finalBody });

    // Every non-blank line in the framed payload must carry the `data:` prefix
    // — otherwise SSE consumers drop the trailing JSON lines.
    const framedLines = sse.split(/\r?\n/).filter((line) => line.length > 0);
    expect(framedLines.every((line) => line.startsWith("data: "))).toBe(true);

    // And after parsing, the recovered object must round-trip exactly.
    const events = parseSseEvents(sse);
    expect(events.length).toBe(1);
    expect(JSON.parse(events[0].data)).toEqual(finalObj);
  });
});

describe("emitStreamError", () => {
  test("anthropic emits event: error with type=error", () => {
    const sse = emitStreamError({
      family: "anthropic",
      errorMessage: "all upstream attempts failed",
      errorCode: "upstream_all_attempts_failed",
    });
    const events = parseSseEvents(sse);
    const errEvent = events.find((e) => e.event === "error");
    expect(errEvent).toBeTruthy();
    if (errEvent) {
      const parsed = JSON.parse(errEvent.data);
      expect(parsed.type).toBe("error");
      expect(parsed.error.type).toBe("upstream_all_attempts_failed");
    }

    // Must NOT include any success terminator
    expect(events.some((e) => e.event === "message_stop")).toBe(false);
  });

  test("openai-chat emits a JSON error frame and no [DONE] success terminator", () => {
    const sse = emitStreamError({
      family: "openai-chat",
      errorMessage: "all upstream attempts failed",
      errorCode: "upstream_all_attempts_failed",
    });
    const events = parseSseEvents(sse);

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.data).not.toBe("[DONE]");

    const errPayload = JSON.parse(events[0].data);
    expect(errPayload.error).toBeTruthy();
    expect(errPayload.error.code ?? errPayload.error.type).toBe("upstream_all_attempts_failed");
  });

  test("openai-responses emits response.error and no response.completed", () => {
    const sse = emitStreamError({
      family: "openai-responses",
      errorMessage: "all upstream attempts failed",
      errorCode: "upstream_all_attempts_failed",
    });
    const events = parseSseEvents(sse);
    const errEvent = events.find((e) => e.event === "response.error");
    expect(errEvent).toBeTruthy();
    expect(events.some((e) => e.event === "response.completed")).toBe(false);
  });

  test("gemini emits an error data frame", () => {
    const sse = emitStreamError({
      family: "gemini",
      errorMessage: "all upstream attempts failed",
      errorCode: "upstream_all_attempts_failed",
    });
    const events = parseSseEvents(sse);
    expect(events.length).toBe(1);
    const parsed = JSON.parse(events[0].data);
    expect(parsed.error).toBeTruthy();
  });
});
