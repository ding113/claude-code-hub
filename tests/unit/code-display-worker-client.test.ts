/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AnyWorkerMessage = { type: string; jobId: number; [k: string]: unknown };

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnPostMessage = false;

  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  messages: AnyWorkerMessage[] = [];
  terminated = false;

  constructor(..._args: unknown[]) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: AnyWorkerMessage) {
    if (FakeWorker.throwOnPostMessage) {
      throw new Error("postMessage failed");
    }
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker;

async function importFreshWorkerClient() {
  vi.resetModules();
  return await import("@/components/ui/code-display-worker-client");
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.throwOnPostMessage = false;
});

afterEach(() => {
  (globalThis as unknown as { Worker?: unknown }).Worker = originalWorker;
});

describe("code-display-worker-client (no Worker fallback)", () => {
  test("formatJsonPretty pretty-prints small JSON synchronously", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { formatJsonPretty } = await importFreshWorkerClient();

    const res = await formatJsonPretty({
      text: '{"a":1}',
      indentSize: 2,
      maxOutputBytes: 1_000_000,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toContain('"a": 1');
      expect(res.usedStreaming).toBe(false);
    }
  });

  test("formatJsonPretty returns INVALID_JSON for invalid input", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { formatJsonPretty } = await importFreshWorkerClient();

    const res = await formatJsonPretty({
      text: "not-json",
      indentSize: 2,
      maxOutputBytes: 1_000_000,
    });

    expect(res).toEqual({ ok: false, errorCode: "INVALID_JSON" });
  });

  test("formatJsonPretty returns OUTPUT_TOO_LARGE when output exceeds budget", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { formatJsonPretty } = await importFreshWorkerClient();

    const res = await formatJsonPretty({
      text: '{"a":1}',
      indentSize: 2,
      maxOutputBytes: 10,
    });

    expect(res).toEqual({ ok: false, errorCode: "OUTPUT_TOO_LARGE" });
  });

  test("formatJsonPretty returns WORKER_UNAVAILABLE for very large JSON (avoid main thread freeze)", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { formatJsonPretty } = await importFreshWorkerClient();

    const big = `{"a":"${"x".repeat(200_001)}"}`;
    const res = await formatJsonPretty({
      text: big,
      indentSize: 2,
      maxOutputBytes: 1_000_000_000,
    });

    expect(res).toEqual({ ok: false, errorCode: "WORKER_UNAVAILABLE" });
  });

  test("buildLineIndex returns correct starts and lineCount", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { buildLineIndex } = await importFreshWorkerClient();

    const res = await buildLineIndex({ text: "a\nb\n", maxLines: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.lineStarts)).toEqual([0, 2, 4]);
      expect(res.lineCount).toBe(3);
    }
  });

  test("buildLineIndex supports CRLF line endings", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { buildLineIndex } = await importFreshWorkerClient();

    const res = await buildLineIndex({ text: "a\r\nb\r\n", maxLines: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.lineStarts)).toEqual([0, 3, 6]);
      expect(res.lineCount).toBe(3);
    }
  });

  test("buildLineIndex returns TOO_MANY_LINES when exceeding maxLines", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { buildLineIndex } = await importFreshWorkerClient();

    const res = await buildLineIndex({ text: "a\nb\n", maxLines: 2 });
    expect(res).toEqual({ ok: false, errorCode: "TOO_MANY_LINES", lineCount: 3 });
  });

  test("searchLines returns unique line numbers that contain the query", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { searchLines } = await importFreshWorkerClient();

    const text = ["alpha", "beta", "alpha gamma", "delta"].join("\n");
    const res = await searchLines({ text, query: "alpha", maxResults: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.matches)).toEqual([0, 2]);
    }
  });

  test("searchLines supports CRLF line endings", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    const { searchLines } = await importFreshWorkerClient();

    const text = ["alpha", "beta", "alpha gamma", "delta"].join("\r\n");
    const res = await searchLines({ text, query: "alpha", maxResults: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.matches)).toEqual([0, 2]);
    }
  });
});

describe("code-display-worker-client (Worker mode)", () => {
  test("workerEnabled=false forces no-worker fallback even when Worker exists", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = FakeWorker as unknown;
    const { buildLineIndex } = await importFreshWorkerClient();

    const res = await buildLineIndex({
      text: "a\nb\n",
      maxLines: 100,
      workerEnabled: false,
    });

    expect(FakeWorker.instances.length).toBe(0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.lineStarts)).toEqual([0, 2, 4]);
      expect(res.lineCount).toBe(3);
    }
  });

  test("routes progress messages and resolves buildLineIndex result", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = FakeWorker as unknown;
    const { buildLineIndex } = await importFreshWorkerClient();

    const onProgress = vi.fn();
    const p = buildLineIndex({
      text: "a\nb",
      maxLines: 100,
      onProgress,
    });

    expect(FakeWorker.instances.length).toBe(1);
    const w = FakeWorker.instances[0]!;
    const posted = w.messages.find((m) => m.type === "buildLineIndex");
    expect(posted).toBeTruthy();

    const jobId = (posted as AnyWorkerMessage).jobId;
    w.onmessage?.({ data: { type: "progress", jobId, stage: "index", processed: 1, total: 3 } });
    expect(onProgress).toHaveBeenCalledWith({ stage: "index", processed: 1, total: 3 });

    w.onmessage?.({
      data: {
        type: "buildLineIndexResult",
        jobId,
        ok: true,
        lineStarts: new Int32Array([0, 2]),
        lineCount: 2,
      },
    });

    const resolved = await p;
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(Array.from(resolved.lineStarts)).toEqual([0, 2]);
      expect(resolved.lineCount).toBe(2);
    }
  });

  test("aborting a pending job resolves CANCELED and posts cancel message", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = FakeWorker as unknown;
    const { searchLines } = await importFreshWorkerClient();

    const controller = new AbortController();
    const p = searchLines({
      text: "hello\nworld",
      query: "o",
      maxResults: 100,
      signal: controller.signal,
    });

    expect(FakeWorker.instances.length).toBe(1);
    const w = FakeWorker.instances[0]!;
    const posted = w.messages.find((m) => m.type === "searchLines");
    expect(posted).toBeTruthy();
    const jobId = (posted as AnyWorkerMessage).jobId;

    controller.abort();

    await expect(p).resolves.toEqual({ ok: false, errorCode: "CANCELED" });
    expect(w.messages.some((m) => m.type === "cancel" && m.jobId === jobId)).toBe(true);
  });

  test("postMessage failure resolves UNKNOWN (best-effort)", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = FakeWorker as unknown;
    FakeWorker.throwOnPostMessage = true;
    const { formatJsonPretty } = await importFreshWorkerClient();

    const res = await formatJsonPretty({
      text: '{"a":1}',
      indentSize: 2,
      maxOutputBytes: 1_000_000,
    });

    expect(res).toEqual({ ok: false, errorCode: "UNKNOWN" });
  });

  test("worker onerror resolves pending jobs and resets singleton", async () => {
    (globalThis as unknown as { Worker?: unknown }).Worker = FakeWorker as unknown;
    const { stringifyJsonPretty } = await importFreshWorkerClient();

    const p = stringifyJsonPretty({
      value: { a: 1 },
      indentSize: 2,
      maxOutputBytes: 1_000_000,
    });

    const w = FakeWorker.instances[0]!;
    w.onerror?.();

    await expect(p).resolves.toEqual({ ok: false, errorCode: "UNKNOWN" });

    // second call should create a new worker instance because singleton was reset
    const p2 = stringifyJsonPretty({
      value: { a: 2 },
      indentSize: 2,
      maxOutputBytes: 1_000_000,
    });
    expect(FakeWorker.instances.length).toBe(2);

    // resolve it to avoid pending leak
    const w2 = FakeWorker.instances[1]!;
    const posted = w2.messages.find((m) => m.type === "stringifyJsonPretty");
    const jobId = (posted as AnyWorkerMessage).jobId;
    w2.onmessage?.({
      data: { type: "stringifyJsonPrettyResult", jobId, ok: true, text: '{\n  "a": 2\n}' },
    });
    await expect(p2).resolves.toEqual({ ok: true, text: '{\n  "a": 2\n}' });
  });
});
