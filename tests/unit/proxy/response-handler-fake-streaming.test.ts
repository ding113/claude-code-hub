import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildFakeStreamingNonStreamResponse,
  buildFakeStreamingResponse,
  type AttemptPerformer,
} from "@/app/v1/_lib/proxy/fake-streaming/runner";

const validBody = JSON.stringify({
  id: "msg",
  type: "message",
  content: [{ type: "text", text: "hello" }],
  model: "claude-3",
});

const emptyBody = "";

async function consumeStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

async function readUntilFirstChunk(
  stream: ReadableStream<Uint8Array> | null
): Promise<{ text: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  if (!stream) throw new Error("stream is null");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  return {
    text: value ? decoder.decode(value, { stream: true }) : "",
    reader,
  };
}

describe("buildFakeStreamingResponse — stream path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("emits SSE heartbeat immediately and final emission after success", async () => {
    const performAttempt = vi.fn(async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    }));

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
      heartbeatIntervalMs: 5000,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    await vi.runAllTimersAsync();
    const body = await consumeStream(response.body);

    expect(body.startsWith(": ping\n\n")).toBe(true);
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
    expect(performAttempt).toHaveBeenCalledTimes(1);
  });

  test("retries on empty upstream and only emits provider B final data", async () => {
    const performAttempt = vi.fn(async (index: number) => {
      if (index === 0) return { status: 200, body: emptyBody, providerId: "p1" };
      return { status: 200, body: validBody, providerId: "p2" };
    });

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
      heartbeatIntervalMs: 5000,
    });

    await vi.runAllTimersAsync();
    const body = await consumeStream(response.body);

    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
    // Provider A's empty body must not leak into the stream
    expect(body).not.toContain("p1-data");
    expect(performAttempt).toHaveBeenCalledTimes(2);
  });

  test("emits protocol-compatible error on terminal failure (no success terminator)", async () => {
    const performAttempt = vi.fn(
      async (
        index: number
      ): Promise<{ status: number; body: string; providerId: string } | null> => {
        if (index < 3) return { status: 200, body: emptyBody, providerId: `p${index}` };
        return null;
      }
    );

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
      heartbeatIntervalMs: 5000,
    });

    await vi.runAllTimersAsync();
    const body = await consumeStream(response.body);

    expect(body).toContain("event: error");
    expect(body).not.toContain("event: message_stop");
  });

  test("repeats heartbeat at the configured interval while attempts pend", async () => {
    let releaseAttempt: (() => void) | null = null;
    const performAttempt = vi.fn(
      async () =>
        new Promise<{ status: number; body: string; providerId: string }>((resolve) => {
          releaseAttempt = () => resolve({ status: 200, body: validBody, providerId: "p1" });
        })
    );

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
    });

    expect(response.body).not.toBeNull();
    if (!response.body) throw new Error("body must not be null");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const initial = await reader.read();
    expect(initial.value).toBeTruthy();
    expect(decoder.decode(initial.value, { stream: true }).startsWith(": ping\n\n")).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    const second = await reader.read();
    expect(decoder.decode(second.value, { stream: true })).toContain(": ping\n\n");

    await vi.advanceTimersByTimeAsync(5000);
    const third = await reader.read();
    expect(decoder.decode(third.value, { stream: true })).toContain(": ping\n\n");

    if (releaseAttempt) releaseAttempt();
    await vi.runAllTimersAsync();

    let finalBuffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      finalBuffer += decoder.decode(value, { stream: true });
    }
    expect(finalBuffer).toContain("event: message_stop");
  });

  test("client abort closes the response without emitting success terminator", async () => {
    const abortController = new AbortController();

    let abortFired = false;
    const performAttempt = vi.fn(async (_index: number, signal: AbortSignal) => {
      return new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          abortFired = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 5,
      heartbeatIntervalMs: 5000,
    });

    const { reader, text } = await readUntilFirstChunk(response.body);
    expect(text.startsWith(": ping\n\n")).toBe(true);

    abortController.abort();
    await vi.runAllTimersAsync();

    let buffer = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    expect(abortFired).toBe(true);
    expect(buffer).not.toContain("event: message_stop");
  });
});

describe("buildFakeStreamingNonStreamResponse — non-stream path", () => {
  test("returns final JSON body verbatim without heartbeat for non-stream client", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    });

    const response = await buildFakeStreamingNonStreamResponse({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.text();
    expect(body).toBe(validBody);
  });

  test("returns 502 JSON error when all attempts fail", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: emptyBody,
      providerId: "p1",
    });

    const response = await buildFakeStreamingNonStreamResponse({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 2,
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(body.error.code).toBe("upstream_all_attempts_failed");
  });
});

describe("onCompletion lifecycle hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("stream: fires once with ok=true after successful attempt", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => undefined);

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    await vi.runAllTimersAsync();
    await consumeStream(response.body);
    // Give the microtask queue a chance to drain (onCompletion runs after
    // the terminator emission has been enqueued to the stream).
    await Promise.resolve();
    await Promise.resolve();

    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(true);
    expect(arg.result.finalBody).toBe(validBody);
    expect(arg.errorFromRunner).toBeUndefined();
  });

  test("stream: fires once with ok=false + errorCode on terminal failure", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: emptyBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => undefined);

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    await vi.runAllTimersAsync();
    await consumeStream(response.body);
    await Promise.resolve();
    await Promise.resolve();

    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(false);
    expect(arg.result.errorCode).toBeDefined();
  });

  test("stream: fires with client_abort when signal aborts before completion", async () => {
    const abortController = new AbortController();
    const performAttempt: AttemptPerformer = async (_index, signal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    };
    const onCompletion = vi.fn(async () => undefined);

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    const { reader } = await readUntilFirstChunk(response.body);
    abortController.abort();
    await vi.runAllTimersAsync();
    // Drain any remaining bytes so the underlying promise chain settles.
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(false);
    expect(arg.result.errorCode).toBe("client_abort");
  });

  test("stream: onCompletion throw does not leak into SSE stream", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => {
      throw new Error("persistence blew up");
    });

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    await vi.runAllTimersAsync();
    // Must not throw; must not surface the persistence error in the stream.
    const body = await consumeStream(response.body);
    expect(body).toContain("event: message_stop");
    expect(body).not.toContain("persistence blew up");
  });

  test("non-stream: fires once with ok=true and the final body", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => undefined);

    await buildFakeStreamingNonStreamResponse({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      onCompletion,
    });

    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(true);
    expect(arg.result.finalBody).toBe(validBody);
  });

  test("non-stream: fires once on all-failed with errorCode surfaced", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: emptyBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => undefined);

    const response = await buildFakeStreamingNonStreamResponse({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      onCompletion,
    });

    expect(response.status).toBe(502);
    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(false);
    expect(arg.result.errorCode).toBeDefined();
  });

  test("non-stream: onCompletion throw does not affect the HTTP response", async () => {
    const performAttempt: AttemptPerformer = async () => ({
      status: 200,
      body: validBody,
      providerId: "p1",
    });
    const onCompletion = vi.fn(async () => {
      throw new Error("persistence blew up");
    });

    const response = await buildFakeStreamingNonStreamResponse({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 1,
      onCompletion,
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(validBody);
  });

  test("stream: hook fires with client_abort even when upstream fetch NEVER settles", async () => {
    // Repro for the real-world bug where sw-sub2api-style upstreams accept
    // stream:false but never send a response body, provider has
    // request_timeout_non_streaming_ms=0, so the orchestrator promise stays
    // pending forever. Without an abort-triggered fallback, the completion
    // hook never fires and the message_request row stays with status_code
    // = NULL / provider_chain = NULL forever.
    const abortController = new AbortController();
    // Never-resolving performAttempt, and it also does NOT reject on abort
    // (simulating the case where undici's fetch abort is ineffective / the
    // upstream socket is stuck in a half-open state).
    const performAttempt: AttemptPerformer = () => new Promise<never>(() => {});
    const onCompletion = vi.fn(async () => undefined);

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    // Wait for the first heartbeat so we know the stream started.
    await readUntilFirstChunk(response.body);

    // Client disconnects while orchestrator is still hung.
    abortController.abort();
    await Promise.resolve();
    await Promise.resolve();

    expect(onCompletion).toHaveBeenCalledTimes(1);
    const arg = onCompletion.mock.calls[0][0];
    expect(arg.result.ok).toBe(false);
    expect(arg.result.errorCode).toBe("client_abort");
  });

  test("stream: hook fires exactly once even if orchestrator resolves after abort", async () => {
    // Belt-and-braces: if a slow orchestrator eventually resolves after the
    // abort listener has already fired the hook, the .then() branch must not
    // fire it a second time. Verifies the completionFired guard.
    const abortController = new AbortController();
    let releaseAttempt: (() => void) | null = null;
    const performAttempt: AttemptPerformer = () =>
      new Promise((resolve) => {
        releaseAttempt = () => resolve({ status: 200, body: validBody, providerId: "p1" });
      });
    const onCompletion = vi.fn(async () => undefined);

    const response = buildFakeStreamingResponse({
      family: "anthropic",
      isStream: true,
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 1,
      heartbeatIntervalMs: 5000,
      onCompletion,
    });

    await readUntilFirstChunk(response.body);
    // Abort fires the hook via the abort listener.
    abortController.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(onCompletion).toHaveBeenCalledTimes(1);

    // Orchestrator wakes up *after* the abort — must NOT fire hook again.
    releaseAttempt?.();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    expect(onCompletion).toHaveBeenCalledTimes(1);
  });
});
