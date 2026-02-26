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
  isDevelopment: () => true,
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

describe("proxy dev public paths", () => {
  it("allows /internal/ui-preview/* without any cookie in development", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "dev-public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/internal/ui-preview/statistics-chart"));

    expect(response.headers.get("x-test")).toBe("dev-public-ok");
  });

  it("does not overmatch /internal/ui-preview-xxx", async () => {
    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/internal/ui-preview-xxx"));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location");
    expect(location).toContain("/login");
  });
});
