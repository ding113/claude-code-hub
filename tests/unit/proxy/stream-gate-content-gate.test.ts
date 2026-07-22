import { describe, expect, it } from "vitest";
import { EmptyResponseError, ProxyError } from "@/app/v1/_lib/proxy/errors";
import {
  concatChunks,
  runStreamContentGate,
  StreamPrecommitError,
} from "@/app/v1/_lib/proxy/stream-gate/stream-content-gate";

const encoder = new TextEncoder();

function readerFromChunks(
  chunks: (string | Uint8Array)[],
  options?: { failAfter?: number; failWith?: Error }
): ReadableStreamDefaultReader<Uint8Array> {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options?.failAfter !== undefined && index >= options.failAfter) {
        controller.error(options.failWith ?? new Error("stream failed"));
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index++];
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
  });
  return stream.getReader();
}

const GATE_OPTIONS = {
  family: "anthropic" as const,
  providerId: 7,
  providerName: "test-provider",
  prebufferEventCap: 64,
  prebufferByteCap: 256 * 1024,
};

const PING = 'event: ping\ndata: {"type":"ping"}\n\n';
const MESSAGE_START =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n';
const TEXT_DELTA =
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n';
const ERROR_FRAME =
  'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}\n\n';
const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

async function drainPrefix(chunks: Uint8Array[]): Promise<string> {
  const merged = concatChunks(chunks);
  return merged ? new TextDecoder().decode(merged) : "";
}

describe("runStreamContentGate", () => {
  it("commits on first valid content frame and returns full buffered prefix", async () => {
    const reader = readerFromChunks([PING, MESSAGE_START, TEXT_DELTA, MESSAGE_STOP]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    // 前缀包含中性帧与触发提交的内容帧所在 chunk
    expect(await drainPrefix(result.prefixChunks)).toBe(PING + MESSAGE_START + TEXT_DELTA);
    expect(result.readerDone).toBe(false);
    // 剩余字节（message_stop）仍在 reader 上
    const rest = await reader.read();
    expect(new TextDecoder().decode(rest.value)).toBe(MESSAGE_STOP);
  });

  it("fails over on error frame before content with upstream error body preserved", async () => {
    const reader = readerFromChunks([PING, ERROR_FRAME, TEXT_DELTA]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect(result.error).toBeInstanceOf(StreamPrecommitError);
    const gateError = result.error as StreamPrecommitError;
    expect(gateError.gateReason).toBe("gate_error");
    expect(gateError.statusCode).toBe(502);
    expect(gateError.upstreamError?.body).toContain("overloaded_error");
    expect(gateError.upstreamError?.providerId).toBe(7);
  });

  it("fails over on malformed frame (fail-closed)", async () => {
    const reader = readerFromChunks([PING, "data: {broken json\n\n"]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("decode_error");
  });

  it("treats terminal before content as empty stream", async () => {
    const reader = readerFromChunks([PING, MESSAGE_STOP]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("empty_stream");
  });

  it("treats EOF without any content as empty stream", async () => {
    const reader = readerFromChunks([PING, MESSAGE_START]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("empty_stream");
  });

  it("treats fully empty stream as empty stream", async () => {
    const reader = readerFromChunks([]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("empty_stream");
  });

  it("commits on trailing content frame without terminating blank line", async () => {
    const reader = readerFromChunks([
      'data: {"type":"content_block_delta","delta":{"text":"tail"}}',
    ]);
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(true);
    if (!result.committed) return;
    expect(result.readerDone).toBe(true);
  });

  it("fails with prebuffer_overflow when event cap exceeded", async () => {
    const pings = Array.from({ length: 20 }, () => PING);
    const reader = readerFromChunks(pings);
    const result = await runStreamContentGate(reader, {
      ...GATE_OPTIONS,
      prebufferEventCap: 10,
    });
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("prebuffer_overflow");
  });

  it("fails with prebuffer_overflow when byte cap exceeded", async () => {
    const bigNeutral = `event: ping\ndata: {"type":"ping","pad":"${"x".repeat(4000)}"}\n\n`;
    const reader = readerFromChunks([bigNeutral, bigNeutral, bigNeutral]);
    const result = await runStreamContentGate(reader, {
      ...GATE_OPTIONS,
      prebufferByteCap: 8000,
    });
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect((result.error as StreamPrecommitError).gateReason).toBe("prebuffer_overflow");
  });

  it("propagates read rejection unchanged (timeout/client abort classification stays upstream)", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const reader = readerFromChunks([PING], { failAfter: 1, failWith: abortError });
    const result = await runStreamContentGate(reader, GATE_OPTIONS);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect(result.error).toBe(abortError);
    expect(result.error).not.toBeInstanceOf(StreamPrecommitError);
  });

  it("is invariant to arbitrary chunk splits", async () => {
    const body = PING + MESSAGE_START + TEXT_DELTA;
    const bytes = encoder.encode(body);
    for (const splitAt of [1, 7, 20, 55, bytes.length - 1]) {
      const reader = readerFromChunks([bytes.slice(0, splitAt), bytes.slice(splitAt)]);
      const result = await runStreamContentGate(reader, GATE_OPTIONS);
      expect(result.committed).toBe(true);
      if (!result.committed) continue;
      expect(await drainPrefix(result.prefixChunks)).toBe(body);
    }
  });

  it("openai-chat: [DONE]-only stream is empty, in-stream error fails over", async () => {
    const doneOnly = readerFromChunks(["data: [DONE]\n\n"]);
    const doneResult = await runStreamContentGate(doneOnly, {
      ...GATE_OPTIONS,
      family: "openai-chat",
    });
    expect(doneResult.committed).toBe(false);
    if (!doneResult.committed) {
      expect((doneResult.error as StreamPrecommitError).gateReason).toBe("empty_stream");
    }

    const errorStream = readerFromChunks([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"error":{"message":"rate limited","code":429}}\n\n',
    ]);
    const errorResult = await runStreamContentGate(errorStream, {
      ...GATE_OPTIONS,
      family: "openai-chat",
    });
    expect(errorResult.committed).toBe(false);
    if (!errorResult.committed) {
      expect((errorResult.error as StreamPrecommitError).gateReason).toBe("gate_error");
    }
  });

  it("gemini: usage-only chunks buffer until content commits", async () => {
    const reader = readerFromChunks([
      'data: {"usageMetadata":{"totalTokenCount":1}}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n',
    ]);
    const result = await runStreamContentGate(reader, { ...GATE_OPTIONS, family: "gemini" });
    expect(result.committed).toBe(true);
  });
});

describe("concatChunks", () => {
  it("returns null for empty, identity for single, concatenation for many", () => {
    expect(concatChunks([])).toBeNull();
    const single = encoder.encode("abc");
    expect(concatChunks([single])).toBe(single);
    const merged = concatChunks([encoder.encode("ab"), encoder.encode("cd")]);
    expect(new TextDecoder().decode(merged as Uint8Array)).toBe("abcd");
  });
});

describe("StreamPrecommitError classification", () => {
  it("is a ProxyError with 502 so categorizeErrorAsync yields PROVIDER_ERROR semantics", () => {
    const error = new StreamPrecommitError("gate_error", {
      family: "anthropic",
      providerId: 1,
      providerName: "p",
    });
    expect(error).toBeInstanceOf(ProxyError);
    expect(error.statusCode).toBe(502);
    expect(error).not.toBeInstanceOf(EmptyResponseError);
  });
});
