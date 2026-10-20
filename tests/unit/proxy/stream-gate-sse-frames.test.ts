import { describe, expect, it } from "vitest";
import {
  parseSseBody,
  SseFrameBufferLimitError,
  SseFrameParser,
} from "@/app/v1/_lib/proxy/stream-gate/sse-frames";

function collectAll(parser: SseFrameParser, chunks: Uint8Array[]) {
  const frames = chunks.flatMap((chunk) => parser.push(chunk));
  return [...frames, ...parser.finish()];
}

describe("SseFrameParser", () => {
  it("parses a simple event stream", () => {
    const frames = parseSseBody('event: message_start\ndata: {"a":1}\n\ndata: [DONE]\n\n');
    expect(frames).toEqual([
      { eventName: "message_start", data: '{"a":1}' },
      { eventName: null, data: "[DONE]" },
    ]);
  });

  it("joins multi-line data with newline", () => {
    const frames = parseSseBody("data: line1\ndata: line2\n\n");
    expect(frames).toEqual([{ eventName: null, data: "line1\nline2" }]);
  });

  it("handles CRLF line endings", () => {
    const frames = parseSseBody("event: ping\r\ndata: {}\r\n\r\n");
    expect(frames).toEqual([{ eventName: "ping", data: "{}" }]);
  });

  it("skips comment lines and id/retry fields", () => {
    const frames = parseSseBody(": keep-alive\nid: 42\nretry: 500\ndata: x\n\n");
    expect(frames).toEqual([{ eventName: null, data: "x" }]);
  });

  it("parses newline-delimited raw JSON frames", () => {
    expect(parseSseBody('{"candidates":[]}\n{"error":{"message":"failed"}}\n')).toEqual([
      { eventName: null, data: '{"candidates":[]}' },
      { eventName: null, data: '{"error":{"message":"failed"}}' },
    ]);
  });

  it("event without data emits no frame and resets event name", () => {
    const frames = parseSseBody("event: orphan\n\ndata: y\n\n");
    expect(frames).toEqual([{ eventName: null, data: "y" }]);
  });

  it("emits trailing frame without terminating blank line at EOF", () => {
    const frames = parseSseBody('event: e\ndata: {"z":1}');
    expect(frames).toEqual([{ eventName: "e", data: '{"z":1}' }]);
  });

  it("strips exactly one leading space after data:", () => {
    const frames = parseSseBody("data:  two-spaces\n\ndata:none\n\n");
    expect(frames).toEqual([
      { eventName: null, data: " two-spaces" },
      { eventName: null, data: "none" },
    ]);
  });

  it("handles CRLF split across chunk boundary", () => {
    const encoder = new TextEncoder();
    const parser = new SseFrameParser();
    const frames = collectAll(parser, [
      encoder.encode("data: a\r"),
      encoder.encode("\ndata: b\r\n\r\n"),
    ]);
    expect(frames).toEqual([{ eventName: null, data: "a\nb" }]);
  });

  it("handles UTF-8 codepoint split across chunk boundary", () => {
    const bytes = new TextEncoder().encode("data: 中文内容\n\n");
    // 在多字节码点中间切开
    const splitAt = 8;
    const parser = new SseFrameParser();
    const frames = collectAll(parser, [bytes.slice(0, splitAt), bytes.slice(splitAt)]);
    expect(frames).toEqual([{ eventName: null, data: "中文内容" }]);
  });

  it("byte-split invariance: any single split point yields identical frames", () => {
    const body =
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"text":"你好"}}\r\n\r\n' +
      ": comment\n" +
      "data: part1\ndata: part2\n\n" +
      "event: message_stop\ndata: {}\n\n" +
      "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(body);
    const expected = parseSseBody(body);
    expect(expected.length).toBe(4);
    for (let i = 1; i < bytes.length; i++) {
      const parser = new SseFrameParser();
      const frames = collectAll(parser, [bytes.slice(0, i), bytes.slice(i)]);
      expect(frames).toEqual(expected);
    }
  });

  it("byte-split invariance: byte-by-byte feeding yields identical frames", () => {
    const body = 'event: e1\ndata: {"a":"中"}\n\ndata: tail';
    const bytes = new TextEncoder().encode(body);
    const expected = parseSseBody(body);
    const parser = new SseFrameParser();
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i++) {
      chunks.push(bytes.slice(i, i + 1));
    }
    expect(collectAll(parser, chunks)).toEqual(expected);
  });

  it("rejects an unterminated line that exceeds the configured retained buffer", () => {
    const parser = new SseFrameParser({ maxBufferedCharacters: 16 });

    expect(() => parser.push(new TextEncoder().encode(`data: ${"x".repeat(20)}`))).toThrow(
      SseFrameBufferLimitError
    );
  });

  it("rejects a completed oversized unknown line instead of joining and ignoring it", () => {
    const parser = new SseFrameParser({ maxBufferedCharacters: 16 });

    expect(() => parser.push(new TextEncoder().encode(`unknown: ${"x".repeat(20)}\n`))).toThrow(
      SseFrameBufferLimitError
    );
  });

  it("counts accumulated data lines before an event is dispatched", () => {
    const parser = new SseFrameParser({ maxBufferedCharacters: 10 });

    expect(() => parser.push(new TextEncoder().encode("data: 12345\ndata: 67890\n"))).toThrow(
      SseFrameBufferLimitError
    );
  });

  it("does not count an event name after a later event field replaces it", () => {
    const parser = new SseFrameParser({ maxBufferedCharacters: 11 });

    expect(parser.pushText("event: 1234567890\nevent: abcdefghij\ndata: x\n\n")).toEqual([
      { eventName: "abcdefghij", data: "x" },
    ]);
  });

  it("keeps heavily fragmented empty data lines semantically intact", () => {
    const parser = new SseFrameParser({ maxBufferedCharacters: 20_000 });
    const encoder = new TextEncoder();
    let frames = [] as ReturnType<SseFrameParser["push"]>;
    for (let index = 0; index < 10_000; index += 1) {
      frames = frames.concat(parser.push(encoder.encode("data:\n")));
    }
    frames = frames.concat(parser.push(encoder.encode("\n")));

    expect(frames).toEqual([{ eventName: null, data: "\n".repeat(9_999) }]);
  });

  it("visitor can stop inside one chunk without materializing the remaining frames", () => {
    const parser = new SseFrameParser();
    const body = Array.from({ length: 10_000 }, (_, index) => `data: ${index}\n\n`).join("");
    const visited: string[] = [];

    const consumed = parser.visit(new TextEncoder().encode(body), (_eventName, data) => {
      visited.push(data);
      return visited.length < 3;
    });

    expect(consumed).toBe(false);
    expect(visited).toEqual(["0", "1", "2"]);
  });

  it("supports a separately bounded buffer exemption for recognized frames", () => {
    const parser = new SseFrameParser({
      bufferLimitExemption: {
        maxBufferedCharacters: 128,
        matches: (eventName, dataHead) =>
          eventName === "response.created" && dataHead.includes('"type":"response.created"'),
      },
      maxBufferedCharacters: 16,
    });
    const data = '{"type":"response.created","response":{"input":"large"}}';

    expect(
      collectAll(parser, [new TextEncoder().encode(`event: response.created\ndata: ${data}\n\n`)])
    ).toEqual([{ eventName: "response.created", data }]);
  });

  it("keeps the exemption bounded and resets it after the matching frame", () => {
    const parser = new SseFrameParser({
      bufferLimitExemption: {
        maxBufferedCharacters: 80,
        matches: (eventName) => eventName === "response.created",
      },
      maxBufferedCharacters: 16,
    });
    const encoder = new TextEncoder();

    expect(() =>
      parser.push(encoder.encode(`event: response.created\ndata: ${"x".repeat(81)}\n\n`))
    ).toThrow(SseFrameBufferLimitError);

    expect(
      parser.push(encoder.encode("event: response.created\ndata: 12345678901234567890\n\n"))
    ).toEqual([{ eventName: "response.created", data: "12345678901234567890" }]);
    expect(() => parser.push(encoder.encode(`data: ${"x".repeat(20)}`))).toThrow(
      SseFrameBufferLimitError
    );
  });

  it("keeps the existing unlimited behavior when no retained buffer limit is configured", () => {
    const data = "x".repeat(1024 * 1024 + 1);

    expect(parseSseBody(`data: ${data}\n\n`)).toEqual([{ eventName: null, data }]);
  });
});
