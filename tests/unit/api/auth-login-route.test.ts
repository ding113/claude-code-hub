import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  validateKey: mockValidateKey,
  setAuthCookie: mockSetAuthCookie,
  getSessionTokenMode: mockGetSessionTokenMode,
  getLoginRedirectTarget: mockGetLoginRedirectTarget,
  withNoStoreHeaders: <T>(res: T): T => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

function makeRequest(
  body: unknown,
  opts?: { locale?: string; acceptLanguage?: string }
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (opts?.acceptLanguage) {
    headers["accept-language"] = opts.acceptLanguage;
  }

  const req = new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (opts?.locale) {
    req.cookies.set("NEXT_LOCALE", opts.locale);
  }

  return req;
}

const fakeSession = {
  user: {
    id: 1,
    name: "Test User",
    description: "desc",
    role: "user" as const,
  },
  key: { canLoginWebUi: true },
};

const adminSession = {
  user: {
    id: -1,
    name: "Admin Token",
    description: "Environment admin session",
    role: "admin" as const,
  },
  key: { canLoginWebUi: true },
};

const readonlySession = {
  user: {
    id: 2,
    name: "Readonly User",
    description: "readonly",
    role: "user" as const,
  },
  key: { canLoginWebUi: false },
};

describe("POST /api/auth/login", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");

    const mod = await import("../../../src/app/api/auth/login/route");
    POST = mod.POST;
  });

  it("returns 400 when key is missing from body", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "translated:apiKeyRequired" });
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("returns 400 when key is empty string", async () => {
    const res = await POST(makeRequest({ key: "" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "translated:apiKeyRequired" });
  });

  it("returns 401 when validateKey returns null", async () => {
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "bad-key" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: "translated:apiKeyInvalidOrExpired" });
    expect(mockValidateKey).toHaveBeenCalledWith("bad-key", {
      allowReadOnlyAccess: true,
    });
  });

  it("returns 200 with correct body shape on valid key", async () => {
    mockValidateKey.mockResolvedValue(fakeSession);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

    const res = await POST(makeRequest({ key: "valid-key" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      user: {
        id: 1,
        name: "Test User",
        description: "desc",
        role: "user",
      },
      redirectTo: "/dashboard",
      loginType: "dashboard_user",
    });
  });

  it("calls setAuthCookie exactly once on success", async () => {
    mockValidateKey.mockResolvedValue(fakeSession);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

    await POST(makeRequest({ key: "valid-key" }));

    expect(mockSetAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("valid-key");
  });

  it("returns redirectTo from getLoginRedirectTarget", async () => {
    mockValidateKey.mockResolvedValue(fakeSession);
    mockGetLoginRedirectTarget.mockReturnValue("/my-usage");

    const res = await POST(makeRequest({ key: "readonly-key" }));
    const json = await res.json();

    expect(json.redirectTo).toBe("/my-usage");
    expect(mockGetLoginRedirectTarget).toHaveBeenCalledWith(fakeSession);
  });

  it("returns loginType admin for admin session", async () => {
    mockValidateKey.mockResolvedValue(adminSession);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

    const res = await POST(makeRequest({ key: "admin-key" }));
    const json = await res.json();

    expect(json.loginType).toBe("admin");
    expect(json.redirectTo).toBe("/dashboard");
  });

  it("returns loginType dashboard_user for canLoginWebUi user session", async () => {
    mockValidateKey.mockResolvedValue(fakeSession);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

    const res = await POST(makeRequest({ key: "dashboard-key" }));
    const json = await res.json();

    expect(json.loginType).toBe("dashboard_user");
    expect(json.redirectTo).toBe("/dashboard");
  });

  it("returns loginType readonly_user for readonly session", async () => {
    mockValidateKey.mockResolvedValue(readonlySession);
    mockGetLoginRedirectTarget.mockReturnValue("/my-usage");

    const res = await POST(makeRequest({ key: "readonly-key" }));
    const json = await res.json();

    expect(json.loginType).toBe("readonly_user");
    expect(json.redirectTo).toBe("/my-usage");
  });

  it("returns 500 when validateKey throws", async () => {
    mockValidateKey.mockRejectedValue(new Error("DB connection failed"));

    const res = await POST(makeRequest({ key: "some-key" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "translated:serverError" });
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("returns 500 when request.json() throws (malformed body)", async () => {
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json{{{",
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "translated:serverError" });
  });

  it("uses NEXT_LOCALE cookie for translations", async () => {
    mockValidateKey.mockResolvedValue(null);

    await POST(makeRequest({ key: "x" }, { locale: "ja" }));

    expect(mockGetTranslations).toHaveBeenCalledWith({
      locale: "ja",
      namespace: "auth.errors",
    });
  });

  it("detects locale from accept-language header", async () => {
    mockValidateKey.mockResolvedValue(null);

    await POST(makeRequest({ key: "x" }, { acceptLanguage: "ru;q=1.0" }));

    expect(mockGetTranslations).toHaveBeenCalledWith({
      locale: "ru",
      namespace: "auth.errors",
    });
  });

  it("falls back to defaultLocale when getTranslations fails for requested locale", async () => {
    const mockT = vi.fn((key: string) => `fallback:${key}`);
    mockGetTranslations
      .mockRejectedValueOnce(new Error("locale not found"))
      .mockResolvedValueOnce(mockT);
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "x" }, { locale: "ja" }));

    expect(mockGetTranslations).toHaveBeenCalledTimes(2);
    expect(mockGetTranslations).toHaveBeenNthCalledWith(1, {
      locale: "ja",
      namespace: "auth.errors",
    });
    expect(mockGetTranslations).toHaveBeenNthCalledWith(2, {
      locale: "zh-CN",
      namespace: "auth.errors",
    });

    const json = await res.json();
    expect(json.error).toBe("fallback:apiKeyInvalidOrExpired");
  });

  it("returns null translation when both locale and fallback fail", async () => {
    mockGetTranslations
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fallback fail"));
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "x" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: undefined });
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("falls back to defaultLocale when no locale cookie or accept-language", async () => {
    mockValidateKey.mockResolvedValue(null);

    await POST(makeRequest({ key: "x" }));

    expect(mockGetTranslations).toHaveBeenCalledWith({
      locale: "zh-CN",
      namespace: "auth.errors",
    });
  });
});
