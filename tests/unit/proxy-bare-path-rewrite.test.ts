import { describe, expect, it, vi } from "vitest";

// Hoist mocks before imports -- mock transitive dependencies to avoid
// next-intl pulling in next/navigation (not resolvable in vitest)
const mockIntlMiddleware = vi.hoisted(() => vi.fn());
vi.mock("next-intl/middleware", () => ({
  default: () => mockIntlMiddleware,
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["zh-CN", "en"],
    defaultLocale: "zh-CN",
  },
}));

vi.mock("@/lib/config/env.schema", () => ({
  isDevelopment: () => false,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRequest(pathname: string, method = "GET") {
  const url = new URL(`http://localhost:13500${pathname}`);
  return {
    method,
    url: url.href,
    nextUrl: { pathname, clone: () => url },
    cookies: {
      get: () => undefined,
    },
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}

// NextResponse.redirect encodes the target into the Location header
function redirectLocation(response: Response): string | null {
  return response.headers.get("location");
}

describe("proxy bare-path / nested-v1beta redirects", () => {
  it("redirects bare /models to /v1/models", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/models"));
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost:13500/v1/models");
  });

  it("redirects bare /chat/completions to /v1/chat/completions preserving the path", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/chat/completions", "POST"));
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe(
      "http://localhost:13500/v1/chat/completions"
    );
  });

  it("redirects bare /responses to /v1/responses", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/responses", "POST"));
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost:13500/v1/responses");
  });

  it("redirects bare /models/<id> to /v1/models/<id>", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/models/gpt-5.6-luna"));
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe(
      "http://localhost:13500/v1/models/gpt-5.6-luna"
    );
  });

  it("redirects nested /v1/v1beta/... to /v1beta/... stripping the extra /v1", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/v1/v1beta/models/gemini-3.7-flash-high:generateContent",
        "POST"
      )
    );
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe(
      "http://localhost:13500/v1beta/models/gemini-3.7-flash-high:generateContent"
    );
  });

  it("redirects bare /v1/v1beta root to /v1beta", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/v1/v1beta"));
    expect(response.status).toBe(307);
    expect(redirectLocation(response)).toBe("http://localhost:13500/v1beta");
  });

  it("does NOT rewrite dashboard/web paths (no v1 prefix added)", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    // No auth cookie → normal web behavior: redirect to login, NOT an API rewrite
    const response = proxyHandler(makeRequest("/zh-CN/dashboard"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });

  it("passes through /v1 paths untouched (no rewrite, proxy no-op)", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/v1/chat/completions", "POST"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    // No redirect either — direct pass-through
    expect(response.status).toBeLessThan(300);
  });
});
