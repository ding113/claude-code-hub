import {
  brotliCompressSync,
  deflateRawSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import { describe, expect, it } from "vitest";
import { ProxyError } from "./errors";
import {
  decodeRequestBody,
  MAX_CONTENT_ENCODING_LAYERS,
  MAX_DECOMPRESSED_REQUEST_BYTES,
  parseContentEncoding,
} from "./request-body-codec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SAMPLE = JSON.stringify({
  model: "gpt-5-codex",
  stream: true,
  input: [{ role: "user", content: "hello zstd" }],
});

function raw(text = SAMPLE): Uint8Array {
  return encoder.encode(text);
}

function decodedText(result: { buffer: ArrayBuffer }): string {
  return decoder.decode(result.buffer);
}

describe("parseContentEncoding", () => {
  it("returns empty for null/undefined/empty", () => {
    expect(parseContentEncoding(null)).toEqual([]);
    expect(parseContentEncoding(undefined)).toEqual([]);
    expect(parseContentEncoding("")).toEqual([]);
  });

  it("lowercases, trims, and drops identity", () => {
    expect(parseContentEncoding("  ZSTD ")).toEqual(["zstd"]);
    expect(parseContentEncoding("identity")).toEqual([]);
    expect(parseContentEncoding("gzip, identity, BR")).toEqual(["gzip", "br"]);
  });
});

describe("decodeRequestBody", () => {
  it("round-trips zstd", () => {
    const result = decodeRequestBody(zstdCompressSync(raw()), "zstd");
    expect(result.decoded).toBe(true);
    expect(result.encoding).toBe("zstd");
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("round-trips gzip and x-gzip", () => {
    const gz = decodeRequestBody(gzipSync(raw()), "gzip");
    expect(gz.decoded).toBe(true);
    expect(decodedText(gz)).toBe(SAMPLE);

    const xgz = decodeRequestBody(gzipSync(raw()), "x-gzip");
    expect(xgz.decoded).toBe(true);
    expect(decodedText(xgz)).toBe(SAMPLE);
  });

  it("round-trips brotli", () => {
    const result = decodeRequestBody(brotliCompressSync(raw()), "br");
    expect(result.decoded).toBe(true);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("round-trips zlib-wrapped deflate", () => {
    const result = decodeRequestBody(deflateSync(raw()), "deflate");
    expect(result.decoded).toBe(true);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("round-trips raw (headerless) deflate via fallback", () => {
    const result = decodeRequestBody(deflateRawSync(raw()), "deflate");
    expect(result.decoded).toBe(true);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("is case-insensitive", () => {
    const result = decodeRequestBody(gzipSync(raw()), "GZip");
    expect(result.decoded).toBe(true);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("decodes a multi-encoding chain in reverse order", () => {
    // Applied gzip first, then brotli on top -> header "gzip, br".
    const layered = brotliCompressSync(gzipSync(raw()));
    const result = decodeRequestBody(layered, "gzip, br");
    expect(result.decoded).toBe(true);
    expect(result.encoding).toBe("br, gzip");
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it(`decodes up to the layer cap (${MAX_CONTENT_ENCODING_LAYERS} layers)`, () => {
    const layered = gzipSync(gzipSync(gzipSync(raw()))); // 3 layers
    const result = decodeRequestBody(layered, "gzip, gzip, gzip");
    expect(result.decoded).toBe(true);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("rejects content-encoding chains exceeding the layer cap with ProxyError(400)", () => {
    const header = Array(MAX_CONTENT_ENCODING_LAYERS + 1)
      .fill("gzip")
      .join(", ");
    try {
      decodeRequestBody(gzipSync(raw()), header);
      throw new Error("expected decodeRequestBody to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProxyError);
      expect((err as ProxyError).statusCode).toBe(400);
    }
  });

  it("passes through when no content-encoding", () => {
    const result = decodeRequestBody(raw(), null);
    expect(result.decoded).toBe(false);
    expect(result.encoding).toBeNull();
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("passes through identity", () => {
    const result = decodeRequestBody(raw(), "identity");
    expect(result.decoded).toBe(false);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("passes through an empty body even with an encoding header", () => {
    const result = decodeRequestBody(new Uint8Array(0), "zstd");
    expect(result.decoded).toBe(false);
    expect(result.decodedByteLength).toBe(0);
  });

  it("passes through unsupported encodings untouched", () => {
    const result = decodeRequestBody(raw(), "snappy");
    expect(result.decoded).toBe(false);
    expect(result.encoding).toBeNull();
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("does not decode when a chain contains an unsupported encoding", () => {
    const result = decodeRequestBody(gzipSync(raw()), "gzip, snappy");
    expect(result.decoded).toBe(false);
  });

  it("accepts ArrayBuffer input and returns an independent ArrayBuffer", () => {
    const gz = gzipSync(raw());
    const ab = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
    const result = decodeRequestBody(ab, "gzip");
    expect(result.decoded).toBe(true);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    // Decoded output is freshly allocated, never the input compressed buffer.
    expect(result.buffer).not.toBe(ab);
    expect(decodedText(result)).toBe(SAMPLE);
  });

  it("throws ProxyError(413) when decompressed output exceeds the cap (bomb guard)", () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024, 0)); // 1MB of zeros -> tiny gzip
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    try {
      decodeRequestBody(bomb, "gzip", { maxOutputBytes: 1024 });
      throw new Error("expected decodeRequestBody to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProxyError);
      expect((err as ProxyError).statusCode).toBe(413);
    }
  });

  it("throws ProxyError(400) on a corrupt compressed stream", () => {
    const garbage = encoder.encode("this is definitely not a gzip stream");
    try {
      decodeRequestBody(garbage, "gzip");
      throw new Error("expected decodeRequestBody to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProxyError);
      expect((err as ProxyError).statusCode).toBe(400);
    }
  });

  it("exposes a sane default decompression cap", () => {
    expect(MAX_DECOMPRESSED_REQUEST_BYTES).toBe(100 * 1024 * 1024);
  });
});
