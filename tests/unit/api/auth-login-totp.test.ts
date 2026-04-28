import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockVerifyTotpAndGetCounter = vi.hoisted(() => vi.fn());
const mockGetSecuritySubjectId = vi.hoisted(() => vi.fn());
const mockGetUserSecuritySettings = vi.hoisted(() => vi.fn());
const mockSaveTotpLastUsedCounter = vi.hoisted(() => vi.fn());
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
  toKeyFingerprint: vi.fn().mockResolvedValue("sha256:fake"),
  withNoStoreHeaders: <T>(res: T): T => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

vi.mock("@/lib/security/totp", () => ({
  verifyTotpAndGetCounter: mockVerifyTotpAndGetCounter,
}));

vi.mock("@/repository/user-security-settings", () => ({
  getSecuritySubjectId: mockGetSecuritySubjectId,
  getUserSecuritySettings: mockGetUserSecuritySettings,
  saveTotpLastUsedCounter: mockSaveTotpLastUsedCounter,
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

vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: <T>(res: T): T => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify(body),
  });
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

describe("POST /api/auth/login with user-managed TOTP", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);
    mockGetEnvConfig.mockReturnValue({
      ENABLE_SECURE_COOKIES: false,
    });
    mockValidateKey.mockResolvedValue(fakeSession);
    mockGetSecuritySubjectId.mockReturnValue("user:1");
    mockGetUserSecuritySettings.mockResolvedValue({
      subjectId: "user:1",
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
      totpLastUsedCounter: null,
      totpPendingSecret: null,
      totpPendingExpiresAt: null,
      totpBoundAt: new Date("2026-04-27T00:00:00.000Z"),
    });
    mockSaveTotpLastUsedCounter.mockResolvedValue(true);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");
    mockVerifyTotpAndGetCounter.mockReturnValue(null);

    const mod = await import("@/app/api/auth/login/route");
    POST = mod.POST;
  });

  it("does not require an OTP when the current subject has not enabled TOTP", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      subjectId: "user:1",
      totpEnabled: false,
      totpSecret: null,
      totpLastUsedCounter: null,
      totpPendingSecret: null,
      totpPendingExpiresAt: null,
      totpBoundAt: null,
    });

    const res = await POST(makeRequest({ key: "valid-key" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      redirectTo: "/dashboard",
      loginType: "dashboard_user",
    });
    expect(mockVerifyTotpAndGetCounter).not.toHaveBeenCalled();
    expect(mockSetAuthCookie).toHaveBeenCalledWith("valid-key");
  });

  it("requires an OTP code after key validation and before setting a cookie", async () => {
    const res = await POST(makeRequest({ key: "valid-key" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      error: "translated:otpRequired",
      errorCode: "OTP_REQUIRED",
      requiresOtp: true,
      otp: { method: "totp" },
    });
    expect(mockValidateKey).toHaveBeenCalledWith("valid-key", { allowReadOnlyAccess: true });
    expect(mockVerifyTotpAndGetCounter).not.toHaveBeenCalled();
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });

  it("rejects an invalid OTP code without setting a cookie", async () => {
    const res = await POST(makeRequest({ key: "valid-key", otpCode: "000000" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      error: "translated:otpInvalid",
      errorCode: "OTP_INVALID",
    });
    expect(mockVerifyTotpAndGetCounter).toHaveBeenCalledWith({
      secret: "JBSWY3DPEHPK3PXP",
      code: "000000",
    });
    expect(mockSaveTotpLastUsedCounter).not.toHaveBeenCalled();
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });

  it("sets the login cookie after a valid OTP code", async () => {
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });

    const res = await POST(makeRequest({ key: "valid-key", otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(200);
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
    expect(mockSaveTotpLastUsedCounter).toHaveBeenCalledWith("user:1", 123);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("valid-key");
  });

  it("rejects a replayed OTP counter without setting a cookie", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      subjectId: "user:1",
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
      totpLastUsedCounter: 123,
      totpPendingSecret: null,
      totpPendingExpiresAt: null,
      totpBoundAt: new Date("2026-04-27T00:00:00.000Z"),
    });
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });

    const res = await POST(makeRequest({ key: "valid-key", otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      error: "translated:otpInvalid",
      errorCode: "OTP_INVALID",
    });
    expect(mockSaveTotpLastUsedCounter).not.toHaveBeenCalled();
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });

  it("rejects a valid OTP when another request records the same counter first", async () => {
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });
    mockSaveTotpLastUsedCounter.mockResolvedValue(false);

    const res = await POST(makeRequest({ key: "valid-key", otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      error: "translated:otpInvalid",
      errorCode: "OTP_INVALID",
    });
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });
});
