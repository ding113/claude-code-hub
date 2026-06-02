import type { Context } from "hono";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Minimal Hono Context stub covering the surface `ProxySession.fromContext`
 * touches: method, url, header() (all + by-name), and raw Request.
 */
function makeContext(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array | string
): Context {
  const req = new Request(url, { method: "POST", headers, body });
  return {
    req: {
      method: "POST",
      url,
      raw: req,
      header: (name?: string) => {
        if (name === undefined) {
          const all: Record<string, string> = {};
          req.headers.forEach((value, key) => {
            all[key] = value;
          });
          return all;
        }
        return req.headers.get(name) ?? undefined;
      },
    },
  } as unknown as Context;
}

describe("ProxySession.fromContext request body decompression", () => {
  it("decompresses a zstd codex /v1/responses body and strips content-encoding", async () => {
    const payload = JSON.stringify({
      model: "gpt-5-codex",
      stream: true,
      input: [{ role: "user", content: "ping" }],
    });
    const ctx = makeContext(
      "https://hub.test/v1/responses",
      { "content-type": "application/json", "content-encoding": "zstd" },
      zstdCompressSync(encoder.encode(payload))
    );

    const session = await ProxySession.fromContext(ctx);

    expect(session.request.message.model).toBe("gpt-5-codex");
    expect(session.request.message.stream).toBe(true);
    expect(session.request.buffer).toBeDefined();
    expect(decoder.decode(session.request.buffer)).toBe(payload);
    // Upstream must not be told the (now plaintext) body is still zstd-encoded.
    expect(session.headers.get("content-encoding")).toBeNull();
  });

  it("decompresses a gzip /v1/messages body", async () => {
    const payload = JSON.stringify({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
    });
    const ctx = makeContext(
      "https://hub.test/v1/messages",
      { "content-type": "application/json", "content-encoding": "gzip" },
      gzipSync(encoder.encode(payload))
    );

    const session = await ProxySession.fromContext(ctx);

    expect(session.request.message.model).toBe("claude-sonnet-4-5");
    expect(decoder.decode(session.request.buffer)).toBe(payload);
    expect(session.headers.get("content-encoding")).toBeNull();
  });

  it("decompresses for the raw-passthrough /v1/responses/compact endpoint", async () => {
    const payload = JSON.stringify({ model: "gpt-5-codex", input: "compact me" });
    const ctx = makeContext(
      "https://hub.test/v1/responses/compact",
      { "content-type": "application/json", "content-encoding": "zstd" },
      zstdCompressSync(encoder.encode(payload))
    );

    const session = await ProxySession.fromContext(ctx);

    // Raw passthrough forwards session.request.buffer verbatim -> must be plaintext.
    expect(decoder.decode(session.request.buffer)).toBe(payload);
    expect(session.headers.get("content-encoding")).toBeNull();
  });

  it("leaves uncompressed requests untouched", async () => {
    const payload = JSON.stringify({ model: "gpt-5-codex", input: "plain" });
    const ctx = makeContext(
      "https://hub.test/v1/responses",
      { "content-type": "application/json" },
      encoder.encode(payload)
    );

    const session = await ProxySession.fromContext(ctx);

    expect(session.request.message.model).toBe("gpt-5-codex");
    expect(decoder.decode(session.request.buffer)).toBe(payload);
    expect(session.headers.get("content-encoding")).toBeNull();
  });

  it("preserves content-encoding for unsupported encodings (transparent passthrough)", async () => {
    const payload = JSON.stringify({ model: "gpt-5-codex", input: "exotic" });
    const ctx = makeContext(
      "https://hub.test/v1/responses",
      { "content-type": "application/json", "content-encoding": "snappy" },
      encoder.encode(payload)
    );

    const session = await ProxySession.fromContext(ctx);

    // We could not decode it, so we must not strip the header: forward as-is.
    expect(session.headers.get("content-encoding")).toBe("snappy");
  });

  it("surfaces a ProxyError(400) when a declared-compressed body is corrupt", async () => {
    const ctx = makeContext(
      "https://hub.test/v1/responses",
      { "content-type": "application/json", "content-encoding": "gzip" },
      encoder.encode("this is not a valid gzip stream")
    );

    await expect(ProxySession.fromContext(ctx)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("surfaces a ProxyError(400) when the content-encoding chain has too many layers", async () => {
    const payload = JSON.stringify({ model: "gpt-5-codex", input: "x" });
    const ctx = makeContext(
      "https://hub.test/v1/responses",
      { "content-type": "application/json", "content-encoding": "gzip, gzip, gzip, gzip" },
      gzipSync(encoder.encode(payload))
    );

    await expect(ProxySession.fromContext(ctx)).rejects.toMatchObject({ statusCode: 400 });
  });
});
