// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function largeJson(entries: number): string {
  return JSON.stringify({
    messages: Array.from({ length: entries }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} with enough repeated filler text to be worth compressing`,
    })),
  });
}

beforeEach(async () => {
  vi.resetModules();
  mockLoggerWarn.mockClear();
  const { resetPayloadCodecWarnings } = await import("@/lib/compression/payload-codec");
  resetPayloadCodecWarnings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("payload codec", () => {
  it("round-trips a large payload and actually shrinks it", async () => {
    const { compressPayload, decompressPayload, isCompressedPayload } = await import(
      "@/lib/compression/payload-codec"
    );
    const original = largeJson(2000);

    const stored = await compressPayload(original);
    expect(isCompressedPayload(stored)).toBe(true);
    expect(stored.length).toBeLessThan(original.length / 2);
    await expect(decompressPayload(stored)).resolves.toBe(original);
  });

  it("round-trips multibyte text and a multi-megabyte body", async () => {
    const { compressPayload, decompressPayload } = await import("@/lib/compression/payload-codec");

    const multibyte = "界面响应体".repeat(20_000);
    await expect(decompressPayload(await compressPayload(multibyte))).resolves.toBe(multibyte);

    const huge = largeJson(60_000);
    expect(Buffer.byteLength(huge, "utf8")).toBeGreaterThan(5 * 1024 * 1024);
    await expect(decompressPayload(await compressPayload(huge))).resolves.toBe(huge);
  });

  it("passes short payloads through untouched", async () => {
    const { compressPayload, isCompressedPayload } = await import(
      "@/lib/compression/payload-codec"
    );
    const short = JSON.stringify({ model: "claude", messages: [{ role: "user" }] });

    const stored = await compressPayload(short);
    expect(stored).toBe(short);
    expect(isCompressedPayload(stored)).toBe(false);
    await expect(compressPayload("")).resolves.toBe("");
  });

  it("returns plaintext written by an older build untouched", async () => {
    const { decompressPayload } = await import("@/lib/compression/payload-codec");
    const legacy = largeJson(500);

    await expect(decompressPayload(legacy)).resolves.toBe(legacy);
    await expect(decompressPayload("event: message\ndata: {}\n\n")).resolves.toBe(
      "event: message\ndata: {}\n\n"
    );
  });

  it("does not mistake a body that merely starts with the label", async () => {
    const { isCompressedPayload, decompressPayload } = await import(
      "@/lib/compression/payload-codec"
    );
    const lookalike = `zst1:${"a".repeat(100)}`;

    expect(isCompressedPayload(lookalike)).toBe(false);
    await expect(decompressPayload(lookalike)).resolves.toBe(lookalike);
  });

  it("returns the original text and warns once when compression fails", async () => {
    vi.doMock("node:zlib", async () => {
      const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
      return {
        ...actual,
        zstdCompress: (
          _buffer: Buffer,
          _options: unknown,
          callback: (error: Error | null, result?: Buffer) => void
        ) => callback(new Error("zstd unavailable")),
      };
    });

    // doMock 只影响此后重新求值的模块，必须先清空注册表再导入。
    vi.resetModules();
    const { compressPayload } = await import("@/lib/compression/payload-codec");
    const original = largeJson(2000);

    await expect(compressPayload(original)).resolves.toBe(original);
    await expect(compressPayload(original)).resolves.toBe(original);
    expect(
      mockLoggerWarn.mock.calls.filter(
        (call) => call[0] === "[Compression] Payload compression failed, storing raw"
      )
    ).toHaveLength(1);

    vi.doUnmock("node:zlib");
  });

  it("returns the envelope unchanged and warns when the payload is corrupt", async () => {
    const { decompressPayload, PAYLOAD_ENVELOPE_PREFIX } = await import(
      "@/lib/compression/payload-codec"
    );
    const corrupt = `${PAYLOAD_ENVELOPE_PREFIX}${Buffer.from("not really zstd").toString("base64")}`;

    await expect(decompressPayload(corrupt)).resolves.toBe(corrupt);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "[Compression] Payload decompression failed",
      expect.objectContaining({ error: expect.any(String) })
    );
  });
});
