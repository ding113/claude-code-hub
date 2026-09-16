// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProxyError } from "@/app/v1/_lib/proxy/errors";

const provider = { id: 1, name: "test-provider" } as never;

function jsonResponse(body: unknown, status = 502): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("upstream error body truncation", () => {
  it("caps a huge JSON upstream error instead of keeping it whole", async () => {
    const error = await ProxyError.fromUpstreamResponse(
      jsonResponse({ error: { message: "upstream failed", detail: "x".repeat(200_000) } }),
      provider
    );

    const body = error.upstreamError?.body ?? "";
    expect(body.length).toBeLessThanOrEqual(8 * 1024 + 3);
    expect(body.endsWith("...")).toBe(true);
    expect(error.message).toContain("upstream failed");
  });

  it("keeps a small JSON error body intact", async () => {
    const payload = { error: { message: "rate limited", type: "rate_limit_error" } };
    const error = await ProxyError.fromUpstreamResponse(jsonResponse(payload, 429), provider);

    expect(error.upstreamError?.body).toBe(JSON.stringify(payload));
  });

  it("still caps plain text at 500 characters", async () => {
    const error = await ProxyError.fromUpstreamResponse(
      new Response("y".repeat(5000), { status: 500, headers: { "content-type": "text/plain" } }),
      provider
    );

    expect(error.upstreamError?.body).toBe(`${"y".repeat(500)}...`);
  });
});
