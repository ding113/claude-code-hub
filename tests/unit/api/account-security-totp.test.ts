import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetSecuritySubjectId = vi.hoisted(() => vi.fn());
const mockGetUserSecuritySettings = vi.hoisted(() => vi.fn());
const mockSaveTotpSetupPending = vi.hoisted(() => vi.fn());
const mockSaveTotpEnabled = vi.hoisted(() => vi.fn());
const mockSaveTotpLastUsedCounter = vi.hoisted(() => vi.fn());
const mockDisableTotp = vi.hoisted(() => vi.fn());
const mockGenerateBase32Secret = vi.hoisted(() => vi.fn());
const mockBuildTotpAuthUri = vi.hoisted(() => vi.fn());
const mockVerifyTotp = vi.hoisted(() => vi.fn());
const mockVerifyTotpAndGetCounter = vi.hoisted(() => vi.fn());
const mockCreateAuditLogAsync = vi.hoisted(() => vi.fn());
const mockIsTotpSecretEncryptionConfigured = vi.hoisted(() => vi.fn());
const mockGetTotpSecretKeySource = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/user-security-settings", () => ({
  getSecuritySubjectId: mockGetSecuritySubjectId,
  getUserSecuritySettings: mockGetUserSecuritySettings,
  saveTotpSetupPending: mockSaveTotpSetupPending,
  saveTotpEnabled: mockSaveTotpEnabled,
  saveTotpLastUsedCounter: mockSaveTotpLastUsedCounter,
  disableTotp: mockDisableTotp,
}));

vi.mock("@/lib/security/totp", () => ({
  generateBase32Secret: mockGenerateBase32Secret,
  buildTotpAuthUri: mockBuildTotpAuthUri,
  verifyTotp: mockVerifyTotp,
  verifyTotpAndGetCounter: mockVerifyTotpAndGetCounter,
}));

vi.mock("@/lib/security/totp-secret-encryption", () => ({
  isTotpSecretEncryptionConfigured: mockIsTotpSecretEncryptionConfigured,
  getTotpSecretKeySource: mockGetTotpSecretKeySource,
}));

vi.mock("@/repository/audit-log", () => ({
  createAuditLogAsync: mockCreateAuditLogAsync,
}));

vi.mock("@/lib/ip", () => ({
  getClientIpWithFreshSettings: vi.fn().mockResolvedValue("127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const session = {
  user: {
    id: 1,
    name: "Alice",
    role: "admin" as const,
  },
  key: {
    id: 11,
    name: "Alice Key",
  },
};

function makeRequest(body: unknown, init?: RequestInit): NextRequest {
  const headers = init?.headers ?? {};
  return new NextRequest("http://localhost/api/account/security/totp", {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(body: unknown = {}, init?: RequestInit): NextRequest {
  const headers = init?.headers ?? {};
  return new NextRequest("http://localhost/api/account/security/totp", {
    ...init,
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeCrossSiteRequest(body: unknown): NextRequest {
  return {
    headers: new Headers({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }),
    json: async () => body,
  } as NextRequest;
}

function disabledSettings() {
  return {
    subjectId: "user:1",
    totpEnabled: false,
    totpSecret: null,
    totpLastUsedCounter: null,
    totpPendingSecret: null,
    totpPendingExpiresAt: null,
    totpBoundAt: null,
  };
}

function enabledSettings() {
  return {
    subjectId: "user:1",
    totpEnabled: true,
    totpSecret: "CURRENTSECRET",
    totpLastUsedCounter: null,
    totpPendingSecret: null,
    totpPendingExpiresAt: null,
    totpBoundAt: new Date("2026-04-27T00:00:00.000Z"),
  };
}

describe("account security TOTP API", () => {
  let GET: () => Promise<Response>;
  let POST: (request: NextRequest) => Promise<Response>;
  let DELETE: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(session);
    mockGetSecuritySubjectId.mockReturnValue("user:1");
    mockGetUserSecuritySettings.mockResolvedValue(disabledSettings());
    mockSaveTotpSetupPending.mockResolvedValue(undefined);
    mockSaveTotpEnabled.mockResolvedValue(new Date("2026-04-28T00:00:00.000Z"));
    mockSaveTotpLastUsedCounter.mockResolvedValue(true);
    mockDisableTotp.mockResolvedValue(undefined);
    mockGenerateBase32Secret.mockReturnValue("JBSWY3DPEHPK3PXP");
    mockBuildTotpAuthUri.mockReturnValue(
      "otpauth://totp/Claude%20Code%20Hub:Alice?secret=JBSWY3DPEHPK3PXP&issuer=Claude%20Code%20Hub"
    );
    mockVerifyTotp.mockReturnValue(false);
    mockVerifyTotpAndGetCounter.mockReturnValue(null);
    mockCreateAuditLogAsync.mockResolvedValue(undefined);
    mockIsTotpSecretEncryptionConfigured.mockReturnValue(true);
    mockGetTotpSecretKeySource.mockReturnValue("totp-secret-encryption-key");

    const mod = await import("@/app/api/account/security/totp/route");
    GET = mod.GET;
    POST = mod.POST;
    DELETE = mod.DELETE;
  });

  it("returns current TOTP status without exposing the stored secret", async () => {
    mockGetUserSecuritySettings.mockResolvedValue(enabledSettings());

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      enabled: true,
      boundAt: "2026-04-27T00:00:00.000Z",
    });
  });

  it("starts setup by storing a pending server-side secret and returning an otpauth URI", async () => {
    const res = await POST(makeRequest({ action: "setup" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUri:
        "otpauth://totp/Claude%20Code%20Hub:Alice?secret=JBSWY3DPEHPK3PXP&issuer=Claude%20Code%20Hub",
    });
    expect(new Date(json.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mockSaveTotpSetupPending).toHaveBeenCalledWith(
      "user:1",
      "JBSWY3DPEHPK3PXP",
      expect.any(Date)
    );
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });

  it("rejects setup when the TOTP secret encryption key is missing", async () => {
    mockIsTotpSecretEncryptionConfigured.mockReturnValue(false);

    const res = await POST(makeRequest({ action: "setup" }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json).toEqual({ errorCode: "TOTP_ENCRYPTION_NOT_CONFIGURED" });
    expect(mockSaveTotpSetupPending).not.toHaveBeenCalled();
  });

  it("enables TOTP using only the pending server-side secret", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      ...disabledSettings(),
      totpPendingSecret: "JBSWY3DPEHPK3PXP",
      totpPendingExpiresAt: new Date(Date.now() + 60_000),
    });
    mockVerifyTotp.mockReturnValue(true);

    const res = await POST(
      makeRequest({ action: "enable", secret: "CLIENT_SUPPLIED_SECRET", otpCode: "123456" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enabled: true, boundAt: "2026-04-28T00:00:00.000Z" });
    expect(mockVerifyTotp).toHaveBeenCalledWith({
      secret: "JBSWY3DPEHPK3PXP",
      code: "123456",
    });
    expect(mockSaveTotpEnabled).toHaveBeenCalledWith("user:1", "JBSWY3DPEHPK3PXP");
  });

  it("rejects enable requests without a valid pending setup secret", async () => {
    const res = await POST(makeRequest({ action: "enable", otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "SETUP_EXPIRED" });
    expect(mockVerifyTotp).not.toHaveBeenCalled();
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });

  it("requires the current OTP before replacing an already-enabled TOTP secret", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      ...enabledSettings(),
      totpPendingSecret: "NEWSECRET",
      totpPendingExpiresAt: new Date(Date.now() + 60_000),
    });
    mockVerifyTotp.mockReturnValue(true);
    mockVerifyTotpAndGetCounter.mockReturnValue(null);

    const res = await POST(makeRequest({ action: "enable", otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "OTP_INVALID" });
    expect(mockVerifyTotp).toHaveBeenNthCalledWith(1, {
      secret: "NEWSECRET",
      code: "123456",
    });
    expect(mockVerifyTotpAndGetCounter).toHaveBeenCalledWith({
      secret: "CURRENTSECRET",
      code: "",
    });
    expect(mockSaveTotpLastUsedCounter).not.toHaveBeenCalled();
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });

  it("rejects invalid setup codes", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      ...disabledSettings(),
      totpPendingSecret: "JBSWY3DPEHPK3PXP",
      totpPendingExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await POST(makeRequest({ action: "enable", otpCode: "000000" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "OTP_INVALID" });
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });

  it("rejects cross-site setup requests", async () => {
    const request = makeCrossSiteRequest({ action: "setup" });
    expect(request.headers.get("origin")).toBe("https://evil.example");
    expect(request.headers.get("sec-fetch-site")).toBe("cross-site");

    const res = await POST(request);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ errorCode: "CSRF_REJECTED" });
    expect(mockGenerateBase32Secret).not.toHaveBeenCalled();
  });

  it("disables TOTP only after verifying the current OTP", async () => {
    mockGetUserSecuritySettings.mockResolvedValue(enabledSettings());
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });

    const res = await DELETE(makeDeleteRequest({ otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enabled: false });
    expect(mockVerifyTotpAndGetCounter).toHaveBeenCalledWith({
      secret: "CURRENTSECRET",
      code: "123456",
    });
    expect(mockSaveTotpLastUsedCounter).toHaveBeenCalledWith("user:1", 123);
    expect(mockDisableTotp).toHaveBeenCalledWith("user:1");
  });

  it("rejects disable requests with an invalid current OTP", async () => {
    mockGetUserSecuritySettings.mockResolvedValue(enabledSettings());

    const res = await DELETE(makeDeleteRequest({ otpCode: "000000" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "OTP_INVALID" });
    expect(mockSaveTotpLastUsedCounter).not.toHaveBeenCalled();
    expect(mockDisableTotp).not.toHaveBeenCalled();
  });

  it("rejects disable requests that replay the last accepted OTP counter", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      ...enabledSettings(),
      totpLastUsedCounter: 123,
    });
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });

    const res = await DELETE(makeDeleteRequest({ otpCode: "123456" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "OTP_INVALID" });
    expect(mockSaveTotpLastUsedCounter).not.toHaveBeenCalled();
    expect(mockDisableTotp).not.toHaveBeenCalled();
  });

  it("rejects rebind when recording the current OTP counter loses a race", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      ...enabledSettings(),
      totpPendingSecret: "NEWSECRET",
      totpPendingExpiresAt: new Date(Date.now() + 60_000),
    });
    mockVerifyTotp.mockReturnValue(true);
    mockVerifyTotpAndGetCounter.mockReturnValue({ counter: 123 });
    mockSaveTotpLastUsedCounter.mockResolvedValue(false);

    const res = await POST(
      makeRequest({ action: "enable", otpCode: "123456", oldOtpCode: "654321" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ errorCode: "OTP_INVALID" });
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });
});
