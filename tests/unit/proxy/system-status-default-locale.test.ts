import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { intlMiddlewareMock } = vi.hoisted(() => ({
  intlMiddlewareMock: vi.fn(),
}));

vi.mock("next-intl/middleware", () => ({
  default: vi.fn(() => intlMiddlewareMock),
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["zh-CN", "zh-TW", "en", "ru", "ja"],
    defaultLocale: "zh-CN",
  },
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "cch_auth",
}));

vi.mock("@/lib/config/env.schema", () => ({
  isDevelopment: () => false,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
  },
}));

import proxyHandler from "@/proxy";

describe("proxy system-status default locale", () => {
  beforeEach(() => {
    intlMiddlewareMock.mockReset();
  });

  test("redirects bare /system-status to /en/system-status", () => {
    const request = new NextRequest("https://example.com/system-status?from=share");
    const response = proxyHandler(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/en/system-status?from=share");
    expect(intlMiddlewareMock).not.toHaveBeenCalled();
  });
});
