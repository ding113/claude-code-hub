import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => new Response(null, { status: 200 }),
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
});
