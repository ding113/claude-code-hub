import { describe, expect, it, vi } from "vitest";
import {
  createDemandDrivenResponsePump,
  type DemandDrivenResponsePumpCompletion,
} from "./demand-driven-response-pump";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function trackReaderRelease(source: ReadableStream<Uint8Array>) {
  const reader = source.getReader();
  const releaseLock = vi.spyOn(reader, "releaseLock");
  vi.spyOn(source, "getReader").mockReturnValue(reader);
  return releaseLock;
}

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) return text;
    text += decoder.decode(result.value, { stream: true });
  }
}

describe("createDemandDrivenResponsePump", () => {
  it("primes one chunk without reading ahead past an unconsumed pending chunk", async () => {
    const chunks = ["one", "two", "three"].map((chunk) => encoder.encode(chunk));
    let pullCount = 0;
    const onReadStart = vi.fn();
    const observed: string[] = [];
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pullCount++;
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );

    const pump = createDemandDrivenResponsePump({
      source,
      onReadStart,
      onChunk: (chunk) => observed.push(decoder.decode(chunk)),
    });
    await nextTurn();
    await nextTurn();

    expect(pullCount).toBe(1);
    expect(onReadStart).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(["one"]);

    const reader = pump.stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await nextTurn();
    await nextTurn();

    expect(pullCount).toBe(2);
    expect(onReadStart).toHaveBeenCalledTimes(2);
    expect(observed).toEqual(["one", "two"]);

    await reader.cancel("test complete");
    await expect(pump.completion).resolves.toMatchObject({
      streamEndedNormally: true,
      clientAborted: true,
      error: null,
    });
  });

  it("delivers chunks in order and settles after the lookahead discovers EOF", async () => {
    const chunks = ["one", "two", "three"].map((chunk) => encoder.encode(chunk));
    const observed: string[] = [];
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);

    const pump = createDemandDrivenResponsePump({
      source,
      onChunk: (chunk) => observed.push(decoder.decode(chunk)),
    });
    const text = await readText(pump.stream.getReader());
    const completion = await pump.completion;

    expect(text).toBe("onetwothree");
    expect(observed).toEqual(["one", "two", "three"]);
    expect(completion).toEqual({
      streamEndedNormally: true,
      clientAborted: false,
      error: null,
    });
    expect(pump.getState()).toBe("closed");
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("returns from client cancellation before a blocked source read and drains in background", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    let pullCount = 0;
    const observed: string[] = [];
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
        pull(controller) {
          pullCount++;
          if (pullCount === 2) {
            controller.enqueue(encoder.encode("tail"));
          } else if (pullCount === 3) {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);
    const onClientCancel = vi.fn();
    const pump = createDemandDrivenResponsePump({
      source,
      onChunk: (chunk) => observed.push(decoder.decode(chunk)),
      onClientCancel,
    });
    const reader = pump.stream.getReader();

    const cancelResult = await Promise.race([
      reader.cancel("client disconnected").then(() => "cancelled" as const),
      nextTurn().then(() => "blocked" as const),
    ]);

    expect(cancelResult).toBe("cancelled");
    expect(pump.getState()).toBe("draining");
    expect(pump.wasClientAborted()).toBe(true);
    expect(onClientCancel).toHaveBeenCalledWith("client disconnected");
    expect(pullCount).toBe(1);

    sourceState.controller?.enqueue(encoder.encode("head"));
    const completion = await pump.completion;

    expect(completion).toEqual({
      streamEndedNormally: true,
      clientAborted: true,
      error: null,
    });
    expect(observed).toEqual(["head", "tail"]);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("settles a pending downstream read when an external client signal starts drain", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
      },
      { highWaterMark: 0 }
    );
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const pendingRead = pump.stream.getReader().read();
    const clientError = new Error("client signal aborted");

    pump.startDrain(clientError);
    const outcome = await Promise.race([
      pendingRead.then(
        (result) => ({ kind: "resolved" as const, result }),
        (error) => ({ kind: "rejected" as const, error })
      ),
      nextTurn().then(() => ({ kind: "pending" as const })),
    ]);

    sourceState.controller?.close();
    await pump.completion;
    expect(outcome).toEqual({ kind: "rejected", error: clientError });
  });

  it("hard-cancels an abort-insensitive source while preserving client-aborted state", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>(
      {
        cancel,
      },
      { highWaterMark: 0 }
    );
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const clientError = new Error("client disconnected");
    const timeoutError = new Error("drain timeout");

    pump.startDrain(clientError);
    pump.cancelSource(timeoutError);
    const completion = await pump.completion;

    expect(cancel).toHaveBeenCalledWith(timeoutError);
    expect(completion).toEqual({
      streamEndedNormally: false,
      clientAborted: true,
      error: timeoutError,
    });
    expect(pump.getState()).toBe("closed");
  });

  it("settles hard cancellation even when the source cancel promise never resolves", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const source = new ReadableStream<Uint8Array>(
      {
        cancel,
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const timeoutError = new Error("drain timeout");

    pump.startDrain(new Error("client disconnected"));
    pump.cancelSource(timeoutError);

    await expect(pump.completion).resolves.toEqual({
      streamEndedNormally: false,
      clientAborted: true,
      error: timeoutError,
    });
    await expect(pump.teardown).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledWith(timeoutError);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("drains an already pending chunk without observing it twice", async () => {
    const chunks = ["one", "two", "three"].map((chunk) => encoder.encode(chunk));
    const observed: string[] = [];
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    const pump = createDemandDrivenResponsePump({
      source,
      onChunk: (chunk) => observed.push(decoder.decode(chunk)),
    });
    await nextTurn();

    await pump.stream.cancel("client disconnected");
    await pump.completion;

    expect(observed).toEqual(["one", "two", "three"]);
  });

  it("errors the downstream client then transfers source ownership to the drain", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const reader = pump.stream.getReader();
    const pendingRead = reader.read();
    const clientError = new Error("downstream deadline");

    pump.errorClient(clientError);

    await expect(pendingRead).rejects.toBe(clientError);
    expect(pump.getState()).toBe("draining");
    expect(pump.wasClientAborted()).toBe(false);

    sourceState.controller?.close();
    await expect(pump.completion).resolves.toEqual({
      streamEndedNormally: true,
      clientAborted: false,
      error: null,
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("preserves a server-owned drain when a later client abort arrives", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
      },
      { highWaterMark: 0 }
    );
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const reader = pump.stream.getReader();
    const pendingRead = reader.read();
    const idleTimeoutError = new Error("streaming_idle");

    pump.errorClient(idleTimeoutError);
    await expect(pendingRead).rejects.toBe(idleTimeoutError);

    pump.startDrain(new Error("late client abort"));
    sourceState.controller?.error(idleTimeoutError);

    await expect(pump.completion).resolves.toEqual({
      streamEndedNormally: false,
      clientAborted: false,
      error: idleTimeoutError,
    });
  });

  it("forwards the original source error and settles only once during a cancel race", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const reader = pump.stream.getReader();
    const pendingRead = reader.read();
    const completionResults: DemandDrivenResponsePumpCompletion[] = [];
    void pump.completion.then((completion) => completionResults.push(completion));
    const upstreamError = new Error("upstream failed");

    const cancelPromise = reader.cancel("client disconnected");
    sourceState.controller?.error(upstreamError);

    await cancelPromise;
    const completion = await pump.completion;
    pump.startDrain("late drain");
    pump.errorClient(new Error("late client error"));
    await nextTurn();

    await expect(pendingRead).resolves.toEqual({ done: true, value: undefined });
    expect(completion).toEqual({
      streamEndedNormally: false,
      clientAborted: true,
      error: upstreamError,
    });
    expect(completionResults).toEqual([completion]);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("errors an active downstream reader when the source fails during the primed read", async () => {
    const sourceState: {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
    } = { controller: null };
    const source = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          sourceState.controller = controller;
        },
      },
      { highWaterMark: 0 }
    );
    const releaseLock = trackReaderRelease(source);
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const reader = pump.stream.getReader();
    const upstreamError = new Error("upstream failed");

    sourceState.controller?.error(upstreamError);

    await expect(reader.read()).rejects.toBe(upstreamError);
    await expect(pump.completion).resolves.toEqual({
      streamEndedNormally: false,
      clientAborted: false,
      error: upstreamError,
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("cancels the source when the primed read fails", async () => {
    const sourceError = new Error("source-read-failed");
    // Web Stream 已 errored 时，cancel() 会以原始 sourceError 拒绝。
    const cancel = vi.fn(() => Promise.reject(sourceError));
    const releaseLock = vi.fn();
    const reader = {
      read: vi.fn(() => Promise.reject(sourceError)),
      cancel,
      releaseLock,
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const source = {
      getReader: vi.fn(() => reader),
    } as unknown as ReadableStream<Uint8Array>;

    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });

    await expect(pump.completion).resolves.toMatchObject({
      streamEndedNormally: false,
      error: sourceError,
    });
    expect(cancel).toHaveBeenCalledWith(sourceError);
    expect(releaseLock).toHaveBeenCalledOnce();
    await nextTurn();
    expect(sourceError.cause).toBeUndefined();
    expect(() => JSON.stringify(sourceError)).not.toThrow();
  });

  it("finishes a metering drain without reporting a source error", async () => {
    const cancelGate = createDeferred<void>();
    const cancel = vi.fn(() => cancelGate.promise);
    const releaseLock = vi.fn();
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})),
      cancel,
      releaseLock,
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const source = {
      getReader: vi.fn(() => reader),
    } as unknown as ReadableStream<Uint8Array>;
    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    let teardownSettled = false;
    void pump.teardown.then(() => {
      teardownSettled = true;
    });

    pump.startDrain("client detached");
    pump.finishDrain("terminal usage captured");

    await expect(pump.completion).resolves.toEqual({
      streamEndedNormally: false,
      clientAborted: true,
      error: null,
    });
    expect(cancel).toHaveBeenCalledOnce();
    await pump.teardown;
    expect(teardownSettled).toBe(true);

    cancelGate.resolve();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
