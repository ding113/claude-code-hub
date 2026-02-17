import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

function makeRequest(
  body: unknown,
  opts?: { locale?: string; acceptLanguage?: string; xForwardedProto?: string }
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (opts?.acceptLanguage) {
    headers["accept-language"] = opts.acceptLanguage;
  }

  headers["x-forwarded-proto"] = opts?.xForwardedProto ?? "https";

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

describe("POST /api/auth/login failure taxonomy", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });

    const mod = await import("../../../src/app/api/auth/login/route");
    POST = mod.POST;
  });

  it("returns KEY_REQUIRED taxonomy for missing key", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: "translated:apiKeyRequired",
      errorCode: "KEY_REQUIRED",
    });
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("returns KEY_INVALID taxonomy for invalid key", async () => {
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "bad-key" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({
      error: "translated:apiKeyInvalidOrExpired",
      errorCode: "KEY_INVALID",
    });
  });

  it("returns SERVER_ERROR taxonomy when validation throws", async () => {
    mockValidateKey.mockRejectedValue(new Error("DB connection failed"));

    const res = await POST(makeRequest({ key: "some-key" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      error: "translated:serverError",
      errorCode: "SERVER_ERROR",
    });
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("adds httpMismatchGuidance on invalid key when secure cookies require HTTPS", async () => {
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "bad-key" }, { xForwardedProto: "http" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("translated:apiKeyInvalidOrExpired");
    expect(json.errorCode).toBe("KEY_INVALID");
    expect(typeof json.httpMismatchGuidance).toBe("string");
    expect(json.httpMismatchGuidance.length).toBeGreaterThan(0);
  });

  it("does not add httpMismatchGuidance when no HTTPS mismatch", async () => {
    mockValidateKey.mockResolvedValue(null);

    const noSecureCookieRes = await POST(
      makeRequest({ key: "bad-key" }, { xForwardedProto: "http" })
    );

    expect(noSecureCookieRes.status).toBe(401);
    expect(await noSecureCookieRes.json()).toEqual({
      error: "translated:apiKeyInvalidOrExpired",
      errorCode: "KEY_INVALID",
    });

    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    const httpsRes = await POST(makeRequest({ key: "bad-key" }, { xForwardedProto: "https" }));

    expect(httpsRes.status).toBe(401);
    expect(await httpsRes.json()).toEqual({
      error: "translated:apiKeyInvalidOrExpired",
      errorCode: "KEY_INVALID",
    });
  });
});
