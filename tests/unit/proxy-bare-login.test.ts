import { describe, expect, it, vi } from "vitest";

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

describe("proxy handler behavior for bare paths", () => {
  it("/login passes through to intl (public path)", async () => {
    const localeResponse = new Response(null, { status: 307, headers: { location: "/zh-CN/login" } });
    mockIntlMiddleware.mockReturnValue(localeResponse);
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/login"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/zh-CN/login");
  });

  it("/models is rewritten to /v1/models", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/models"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost:13500/v1/models");
  });

  it("/v1beta direct path is untouched", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/v1beta/models"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
