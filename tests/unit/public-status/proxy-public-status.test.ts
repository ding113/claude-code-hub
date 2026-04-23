import { beforeEach, describe, expect, it, vi } from "vitest";

const nextResponseNext = vi.hoisted(() => vi.fn((input?: unknown) => input ?? { ok: true }));
const nextResponseRedirect = vi.hoisted(() => vi.fn((url: URL) => ({ url: url.toString() })));
const intlMiddlewareMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));

vi.mock("next/server", () => ({
  NextResponse: {
    next: nextResponseNext,
    redirect: nextResponseRedirect,
  },
}));

vi.mock("next-intl/middleware", () => ({
  default: vi.fn(() => intlMiddlewareMock),
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["en", "zh-CN"],
    defaultLocale: "en",
  },
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "cch-auth",
}));

vi.mock("@/lib/config/env.schema", () => ({
  isDevelopment: () => false,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
  },
}));

describe("public-status proxy header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("adds the public-status header for locale-prefixed status pages", async () => {
    const mod = await import("@/proxy");
    const request = {
      method: "GET",
      headers: new Headers(),
      nextUrl: {
        pathname: "/en/status",
        clone: () => new URL("http://localhost/en/status"),
      },
      cookies: {
        get: vi.fn(),
      },
    } as never;

    mod.default(request);

    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(intlMiddlewareMock).not.toHaveBeenCalled();

    const [{ request: nextRequest }] = nextResponseNext.mock.calls[0] as [
      {
        request: { headers: Headers };
      },
    ];
    expect(nextRequest.headers.get("x-cch-public-status")).toBe("1");
  });
});
