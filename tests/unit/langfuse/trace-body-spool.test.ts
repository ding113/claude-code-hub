// @vitest-environment node
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { getMemoryGovernor } from "@/lib/memory/governor";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const encoder = new TextEncoder();

let governor: InstanceType<typeof MemoryGovernor>;

function useGovernor(limitBytes: number): void {
  governor = new MemoryGovernor({ limit: limitBytes, remote: false, monitor: false });
  vi.spyOn(getMemoryGovernor(), "tryLease").mockImplementation((bytes) => governor.tryLease(bytes));
}

async function loadSpool() {
  return import("@/lib/langfuse/trace-body-spool");
}

function sseFrame(index: number): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text: `chunk ${index} of streamed model output` },
  })}\n\n`;
}

beforeEach(() => {
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
  mockLoggerWarn.mockClear();
  useGovernor(64 * 1024 ** 2);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tryCreateLangfuseTraceBodySpool", () => {
  it("returns null without Langfuse credentials and takes no lease", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();

    expect(tryCreateLangfuseTraceBodySpool()).toBeNull();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("returns null when the memory governor refuses the scratch lease", async () => {
    useGovernor(1024);
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();

    expect(tryCreateLangfuseTraceBodySpool()).toBeNull();
  });
});

describe("LangfuseTraceBodySpool", () => {
  it("materializes a small stream without ever creating a compressor", async () => {
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const compressorFactory = vi.fn(() => new PassThrough());
    const spool = tryCreateLangfuseTraceBodySpool({ compressorFactory });
    if (!spool) throw new Error("expected a spool");

    let expected = "";
    for (let i = 0; i < 200; i++) {
      const frame = sseFrame(i);
      expected += frame;
      spool.observe(encoder.encode(frame));
    }

    await expect(spool.materialize()).resolves.toBe(expected);
    expect(compressorFactory).not.toHaveBeenCalled();

    await spool.dispose();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("round-trips a multi-megabyte stream through one shared zstd context", async () => {
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const spool = tryCreateLangfuseTraceBodySpool();
    if (!spool) throw new Error("expected a spool");

    let expected = "";
    for (let i = 0; i < 30_000; i++) expected += sseFrame(i);
    const bytes = encoder.encode(expected);
    expect(bytes.byteLength).toBeGreaterThan(4 * 1024 * 1024);

    for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
      spool.observe(bytes.subarray(offset, offset + 32 * 1024));
    }

    await expect(spool.materialize()).resolves.toBe(expected);

    await spool.dispose();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("keeps multibyte characters intact when a chunk splits them", async () => {
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const spool = tryCreateLangfuseTraceBodySpool({ hotBytes: 1024 });
    if (!spool) throw new Error("expected a spool");

    const expected = "界面".repeat(40_000);
    const bytes = encoder.encode(expected);
    // 每 7 字节切一刀，必然落在三字节字符中间
    for (let offset = 0; offset < bytes.byteLength; offset += 7) {
      spool.observe(bytes.subarray(offset, offset + 7));
    }

    const text = await spool.materialize();
    expect(text).toBe(expected);
    expect(text).not.toContain(String.fromCharCode(0xfffd));

    await spool.dispose();
  });

  it("fails open once the lease cannot cover the compressor and ignores later chunks", async () => {
    useGovernor(STORE_SCRATCH_BYTES + 256 * 1024);
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const spool = tryCreateLangfuseTraceBodySpool({ hotBytes: 64 * 1024 });
    if (!spool) throw new Error("expected a spool");

    const block = encoder.encode("x".repeat(32 * 1024));
    for (let i = 0; i < 40; i++) spool.observe(block);

    await expect(spool.materialize()).resolves.toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "[Langfuse] Trace body spool disabled",
      expect.objectContaining({ reason: "memory_lease_exhausted" })
    );
    const warnCount = mockLoggerWarn.mock.calls.length;

    spool.observe(block);
    expect(mockLoggerWarn.mock.calls.length).toBe(warnCount);
    await expect(spool.materialize()).resolves.toBeNull();

    await spool.dispose();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("returns null when the compressor emits an error", async () => {
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const compressor = new PassThrough();
    const spool = tryCreateLangfuseTraceBodySpool({
      hotBytes: 1024,
      compressorFactory: () => compressor,
    });
    if (!spool) throw new Error("expected a spool");

    spool.observe(encoder.encode("y".repeat(64 * 1024)));
    compressor.emit("error", new Error("compressor exploded"));

    await expect(spool.materialize()).resolves.toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "[Langfuse] Trace body spool disabled",
      expect.objectContaining({ reason: "compressor_error" })
    );

    await spool.dispose();
  });

  it("shares one promise across disposes and ignores observes afterwards", async () => {
    const { tryCreateLangfuseTraceBodySpool } = await loadSpool();
    const spool = tryCreateLangfuseTraceBodySpool();
    if (!spool) throw new Error("expected a spool");

    spool.observe(encoder.encode(sseFrame(1)));
    const first = spool.dispose();
    expect(spool.dispose()).toBe(first);
    await first;

    expect(() => spool.observe(encoder.encode(sseFrame(2)))).not.toThrow();
    await expect(spool.materialize()).resolves.toBeNull();
    expect(governor.snapshot().usedBytes).toBe(0);
  });
});
