import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetSecuritySubjectId = vi.hoisted(() => vi.fn());
const mockGetUserSecuritySettings = vi.hoisted(() => vi.fn());
const mockSaveTotpEnabled = vi.hoisted(() => vi.fn());
const mockDisableTotp = vi.hoisted(() => vi.fn());
const mockGenerateBase32Secret = vi.hoisted(() => vi.fn());
const mockBuildTotpAuthUri = vi.hoisted(() => vi.fn());
const mockVerifyTotp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/user-security-settings", () => ({
  getSecuritySubjectId: mockGetSecuritySubjectId,
  getUserSecuritySettings: mockGetUserSecuritySettings,
  saveTotpEnabled: mockSaveTotpEnabled,
  disableTotp: mockDisableTotp,
}));

vi.mock("@/lib/security/totp", () => ({
  generateBase32Secret: mockGenerateBase32Secret,
  buildTotpAuthUri: mockBuildTotpAuthUri,
  verifyTotp: mockVerifyTotp,
}));

const session = {
  user: {
    id: 1,
    name: "Alice",
    role: "admin" as const,
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

function makeDeleteRequest(init?: RequestInit): NextRequest {
  return new NextRequest("http://localhost/api/account/security/totp", {
    method: "DELETE",
    ...init,
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

describe("account security TOTP API", () => {
  let GET: () => Promise<Response>;
  let POST: (request: NextRequest) => Promise<Response>;
  let DELETE: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(session);
    mockGetSecuritySubjectId.mockReturnValue("user:1");
    mockGetUserSecuritySettings.mockResolvedValue({
      subjectId: "user:1",
      totpEnabled: false,
      totpSecret: null,
      totpBoundAt: null,
    });
    mockGenerateBase32Secret.mockReturnValue("JBSWY3DPEHPK3PXP");
    mockBuildTotpAuthUri.mockReturnValue(
      "otpauth://totp/Claude%20Code%20Hub:Alice?secret=JBSWY3DPEHPK3PXP&issuer=Claude%20Code%20Hub"
    );
    mockVerifyTotp.mockReturnValue(false);

    const mod = await import("@/app/api/account/security/totp/route");
    GET = mod.GET;
    POST = mod.POST;
    DELETE = mod.DELETE;
  });

  it("returns current TOTP status without exposing the stored secret", async () => {
    mockGetUserSecuritySettings.mockResolvedValue({
      subjectId: "user:1",
      totpEnabled: true,
      totpSecret: "secret",
      totpBoundAt: new Date("2026-04-27T00:00:00.000Z"),
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      enabled: true,
      boundAt: "2026-04-27T00:00:00.000Z",
    });
  });

  it("starts setup by returning a temporary secret and otpauth URI", async () => {
    const res = await POST(makeRequest({ action: "setup" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUri:
        "otpauth://totp/Claude%20Code%20Hub:Alice?secret=JBSWY3DPEHPK3PXP&issuer=Claude%20Code%20Hub",
    });
    expect(mockSaveTotpEnabled).not.toHaveBeenCalled();
  });

  it("enables TOTP only after verifying the submitted setup code", async () => {
    mockVerifyTotp.mockReturnValue(true);

    const res = await POST(
      makeRequest({ action: "enable", secret: "JBSWY3DPEHPK3PXP", otpCode: "123456" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enabled: true });
    expect(mockVerifyTotp).toHaveBeenCalledWith({
      secret: "JBSWY3DPEHPK3PXP",
      code: "123456",
    });
    expect(mockSaveTotpEnabled).toHaveBeenCalledWith("user:1", "JBSWY3DPEHPK3PXP");
  });

  it("rejects invalid setup codes", async () => {
    const res = await POST(
      makeRequest({ action: "enable", secret: "JBSWY3DPEHPK3PXP", otpCode: "000000" })
    );
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

  it("disables TOTP for the current subject", async () => {
    const res = await DELETE(makeDeleteRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enabled: false });
    expect(mockDisableTotp).toHaveBeenCalledWith("user:1");
  });
});
