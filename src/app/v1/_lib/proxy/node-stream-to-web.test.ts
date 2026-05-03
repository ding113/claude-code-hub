import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { nodeStreamToWebStreamSafe } from "./node-stream-to-web";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    if (value) chunks.push(value);
  }
}

describe("nodeStreamToWebStreamSafe", () => {
  it("forwards chunks then closes when the source ends normally", async () => {
    const node = Readable.from([Buffer.from("hello "), Buffer.from("world")]);

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();
    const chunks = await readAll(reader);

    const decoded = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    expect(decoded).toBe("hello world");

    // Listeners must be detached after end
    expect(node.listenerCount("data")).toBe(0);
    expect(node.listenerCount("end")).toBe(0);
    expect(node.listenerCount("close")).toBe(0);
    expect(node.listenerCount("error")).toBe(0);
  });

  it("propagates source errors as a stream error to the reader", async () => {
    // Pause the readable so we have time to emit error after attaching listeners
    const node = new Readable({
      read() {
        // no-op, push manually
      },
    });

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();

    const boom = new Error("boom");
    queueMicrotask(() => node.emit("error", boom));

    await expect(reader.read()).rejects.toThrow("boom");
    // After error settles, listeners must be detached
    expect(node.listenerCount("data")).toBe(0);
    expect(node.listenerCount("end")).toBe(0);
    expect(node.listenerCount("close")).toBe(0);
    expect(node.listenerCount("error")).toBe(0);
  });

  it("destroys the source and detaches listeners on cancel(), and ignores subsequent events", async () => {
    const node = new Readable({
      read() {
        // no-op
      },
    });
    // Spy on destroy to confirm we call it exactly once
    const destroySpy = vi.spyOn(node, "destroy");

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();
    // Consume nothing — cancel mid-stream
    await reader.cancel(new Error("client gone"));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    // Wait for the destroy "close" event to fire so the cleanup once-listener
    // can run and remove the swallowing error handler.
    await new Promise((resolve) => setImmediate(resolve));
    // Wrapper-registered data/end/close listeners are detached. A swallowing
    // error listener is intentionally attached just before destroy(reason) so
    // Node's emit("error", reason) does not become an uncaughtException;
    // the close-listener cleanup removes it once destroy completes.
    expect(node.listenerCount("data")).toBe(0);
    expect(node.listenerCount("end")).toBe(0);
    expect(node.listenerCount("close")).toBe(0);
    expect(node.listenerCount("error")).toBe(0);

    // Late events from the (now-destroyed) source must not reach the controller —
    // because listeners were detached, emitting these is a no-op for our wrapper.
    // (We assert no throw escapes; the reader is already closed.)
    expect(() => node.emit("data", Buffer.from("late"))).not.toThrow();
    expect(() => node.emit("close")).not.toThrow();
  });

  it("does not leak an error listener when cancel() is called without a reason", async () => {
    const node = new Readable({
      read() {
        // no-op
      },
    });

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();
    // No reason -> destroy() will not re-emit "error", so the swallow listener
    // must be cleaned up via the close-listener fallback.
    await reader.cancel();

    // Wait one tick so the destroy "close" event fires and removes swallow
    await new Promise((resolve) => setImmediate(resolve));
    expect(node.listenerCount("error")).toBe(0);
    expect(node.listenerCount("close")).toBe(0);
  });

  it("is a no-op when cancel() is called twice", async () => {
    const node = new Readable({
      read() {
        // no-op
      },
    });
    const destroySpy = vi.spyOn(node, "destroy");

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();
    await reader.cancel("first");
    // Second cancel should be a no-op — no extra destroy, no extra swallow listener
    await reader.cancel("second");

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it("does not call destroy() twice when cancel() is invoked on an already-destroyed source", async () => {
    const node = new Readable({
      read() {
        // no-op
      },
    });
    node.destroy();
    const destroySpy = vi.spyOn(node, "destroy");

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();
    await reader.cancel("client gone");

    // Wrapper must short-circuit when nodeStream.destroyed is true
    expect(destroySpy).not.toHaveBeenCalled();
  });

  it("treats back-to-back end + close as a single close on the web stream", async () => {
    const node = new Readable({
      read() {
        // no-op
      },
    });

    const web = nodeStreamToWebStreamSafe(node, 1, "test");
    const reader = web.getReader();

    // Push one chunk, then emit both end and close synchronously
    queueMicrotask(() => {
      node.emit("data", Buffer.from("chunk"));
      node.emit("end");
      node.emit("close");
    });

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value as Uint8Array).toString("utf8")).toBe("chunk");

    const second = await reader.read();
    expect(second.done).toBe(true);
    // No throw, reader closed exactly once. Listeners detached.
    expect(node.listenerCount("end")).toBe(0);
    expect(node.listenerCount("close")).toBe(0);
  });
});
