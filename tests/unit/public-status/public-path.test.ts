import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mockIntlMiddleware = vi.hoisted(() =>
  vi.fn((request: NextRequest) => {
    const response = new Response(null, { status: 200 });
    response.headers.set("x-seen-public-status", request.headers.get("x-cch-public-status") ?? "");
    return response;
  })
);

vi.mock("next-intl/middleware", () => ({
  default: () => mockIntlMiddleware,
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["en", "zh-CN"],
    defaultLocale: "zh-CN",
  },
}));

vi.mock("@/lib/config/env.schema", () => ({
  isDevelopment: () => false,
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "cch_auth",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: () => {},
  },
}));

describe("public status proxy path", () => {
  it("allows locale-prefixed public status without redirect", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/status"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects protected routes without auth", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/dashboard"));
    expect(response.headers.get("location")).toContain("/en/login");
  });

  it("redirects bare root to locale login with a dashboard fallback", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/"));
    const location = response.headers.get("location");

    expect(location).toContain("/zh-CN/login");
    expect(location).toContain("from=%2Fdashboard");
  });

  it("prefers NEXT_LOCALE when redirecting an unprefixed protected route", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const request = new NextRequest("http://localhost/dashboard");
    request.cookies.set("NEXT_LOCALE", "en");
    const response = proxyHandler(request);
    const location = response.headers.get("location");

    expect(location).toContain("/en/login");
    expect(location).toContain("from=%2Fdashboard");
  });

  it("falls back safely when NEXT_LOCALE cookie is malformed", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const request = new NextRequest("http://localhost/dashboard");
    request.headers.set("cookie", "NEXT_LOCALE=%E0%A4%A");

    expect(() => proxyHandler(request)).not.toThrow();

    const response = proxyHandler(request);
    const location = response.headers.get("location");

    expect(location).toContain("/zh-CN/login");
    expect(location).toContain("from=%2Fdashboard");
  });

  it("normalizes repeated locale prefixes in the login from parameter", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/en/dashboard"));
    const location = response.headers.get("location");

    expect(location).toContain("/en/login");
    expect(location).toContain("from=%2Fdashboard");
    expect(location).not.toContain("from=%2Fen%2Fdashboard");
  });

  it("redirects locale root to login with a dashboard fallback", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en"));
    const location = response.headers.get("location");

    expect(location).toContain("/en/login");
    expect(location).toContain("from=%2Fdashboard");
  });

  it("strips spoofed x-cch-public-status on non-status requests", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      new NextRequest("http://localhost/en/dashboard", {
        headers: {
          "x-cch-public-status": "1",
          cookie: "cch_auth=test",
        },
      })
    );

    expect(response.headers.get("x-seen-public-status")).toBeNull();
  });
});
