import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
const mockCookieSet = vi.hoisted(() => vi.fn());
const mockCookies = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockClearAuthCookie = vi.hoisted(() => vi.fn());

const realWithNoStoreHeaders = vi.hoisted(() => {
  return <T extends InstanceType<typeof NextResponse>>(response: T): T => {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    return response;
  };
});

vi.mock("@/lib/auth", () => ({
  validateKey: mockValidateKey,
  setAuthCookie: mockSetAuthCookie,
  clearAuthCookie: mockClearAuthCookie,
  getLoginRedirectTarget: mockGetLoginRedirectTarget,
  withNoStoreHeaders: realWithNoStoreHeaders,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/lib/config/config", () => ({ config: { auth: { adminToken: "test" } } }));
vi.mock("@/repository/key", () => ({ validateApiKeyAndGetUser: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const EXPECTED_CACHE_CONTROL = "no-store, no-cache, must-revalidate";
const EXPECTED_PRAGMA = "no-cache";

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fakeSession = {
  user: { id: 1, name: "Test User", description: "desc", role: "user" as const },
  key: { canLoginWebUi: true },
};

describe("session cookie hardening", () => {
  describe("withNoStoreHeaders utility", () => {
    it("sets Cache-Control header", () => {
      const res = NextResponse.json({ ok: true });
      const result = realWithNoStoreHeaders(res);
      expect(result.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("sets Pragma header", () => {
      const res = NextResponse.json({ ok: true });
      const result = realWithNoStoreHeaders(res);
      expect(result.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });

    it("returns the same response object", () => {
      const res = NextResponse.json({ ok: true });
      const result = realWithNoStoreHeaders(res);
      expect(result).toBe(res);
    });
  });

  describe("login route no-store headers", () => {
    let POST: (request: NextRequest) => Promise<Response>;

    beforeEach(async () => {
      vi.clearAllMocks();
      const mockT = vi.fn((key: string) => `translated:${key}`);
      mockGetTranslations.mockResolvedValue(mockT);
      mockSetAuthCookie.mockResolvedValue(undefined);
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });

      const mod = await import("@/app/api/auth/login/route");
      POST = mod.POST;
    });

    it("success response includes Cache-Control: no-store", async () => {
      mockValidateKey.mockResolvedValue(fakeSession);
      mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

      const res = await POST(makeLoginRequest({ key: "valid" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("success response includes Pragma: no-cache", async () => {
      mockValidateKey.mockResolvedValue(fakeSession);
      mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

      const res = await POST(makeLoginRequest({ key: "valid" }));

      expect(res.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });

    it("400 error response includes Cache-Control: no-store", async () => {
      const res = await POST(makeLoginRequest({}));

      expect(res.status).toBe(400);
      expect(res.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("400 error response includes Pragma: no-cache", async () => {
      const res = await POST(makeLoginRequest({}));

      expect(res.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });

    it("401 error response includes Cache-Control: no-store", async () => {
      mockValidateKey.mockResolvedValue(null);

      const res = await POST(makeLoginRequest({ key: "bad" }));

      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("401 error response includes Pragma: no-cache", async () => {
      mockValidateKey.mockResolvedValue(null);

      const res = await POST(makeLoginRequest({ key: "bad" }));

      expect(res.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });

    it("500 error response includes no-store headers", async () => {
      mockValidateKey.mockRejectedValue(new Error("db down"));

      const res = await POST(makeLoginRequest({ key: "any" }));

      expect(res.status).toBe(500);
      expect(res.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
      expect(res.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });
  });

  describe("logout route no-store headers", () => {
    let POST: () => Promise<Response>;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockClearAuthCookie.mockResolvedValue(undefined);

      const mod = await import("@/app/api/auth/logout/route");
      POST = mod.POST;
    });

    it("response includes Cache-Control: no-store", async () => {
      const res = await POST();

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(EXPECTED_CACHE_CONTROL);
    });

    it("response includes Pragma: no-cache", async () => {
      const res = await POST();

      expect(res.headers.get("Pragma")).toBe(EXPECTED_PRAGMA);
    });
  });
});
