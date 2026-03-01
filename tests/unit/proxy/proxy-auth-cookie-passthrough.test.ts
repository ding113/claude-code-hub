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

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  const url = new URL(`http://localhost:13500${pathname}`);
  return {
    method: "GET",
    nextUrl: { pathname, clone: () => url },
    cookies: {
      get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined),
    },
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}

describe("proxy auth cookie passthrough", () => {
  it("redirects to login when no auth cookie is present", async () => {
    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/dashboard"));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("from=");
  });

  it("passes through when auth cookie exists without deleting it", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "locale-response" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/zh-CN/dashboard", { "auth-token": "sid_test-session-id" })
    );

    // Should return the locale response, not a redirect
    expect(response.headers.get("x-test")).toBe("locale-response");
    // Should NOT have a Set-Cookie header that deletes the auth cookie
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeNull();
  });

  it("allows public paths without any cookie", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/login"));

    expect(response.headers.get("x-test")).toBe("public-ok");
  });
});
