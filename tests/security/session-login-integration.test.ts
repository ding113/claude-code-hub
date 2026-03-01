import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockToKeyFingerprint = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const realWithNoStoreHeaders = vi.hoisted(() => {
  return (response: any) => {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    return response;
  };
});

vi.mock("@/lib/auth", () => ({
  validateKey: mockValidateKey,
  setAuthCookie: mockSetAuthCookie,
  getSessionTokenMode: mockGetSessionTokenMode,
  getLoginRedirectTarget: mockGetLoginRedirectTarget,
  toKeyFingerprint: mockToKeyFingerprint,
  withNoStoreHeaders: realWithNoStoreHeaders,
}));

vi.mock("@/lib/auth-session-store/redis-session-store", () => ({
  RedisSessionStore: class {
    create = mockCreateSession;
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

vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: realWithNoStoreHeaders,
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const dashboardSession = {
  user: {
    id: 1,
    name: "Test User",
    description: "desc",
    role: "user" as const,
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

describe("POST /api/auth/login session token mode integration", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);

    mockValidateKey.mockResolvedValue(dashboardSession);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");
    mockToKeyFingerprint.mockResolvedValue(
      "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    );
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });
    mockCreateSession.mockResolvedValue({
      sessionId: "sid_opaque_session_123",
      keyFingerprint: "sha256:abcdef",
      userId: 1,
      userRole: "user",
      createdAt: 100,
      expiresAt: 200,
    });

    const mod = await import("../../src/app/api/auth/login/route");
    POST = mod.POST;
  });

  it("legacy mode keeps raw key cookie and does not create opaque session", async () => {
    mockGetSessionTokenMode.mockReturnValue("legacy");

    const res = await POST(makeRequest({ key: "legacy-key" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("legacy-key");
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(json.redirectTo).toBe("/dashboard");
    expect(json.loginType).toBe("dashboard_user");
  });

  it("dual mode sets legacy cookie and creates opaque session in store", async () => {
    mockGetSessionTokenMode.mockReturnValue("dual");

    const res = await POST(makeRequest({ key: "dual-key" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("dual-key");
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        userRole: "user",
        keyFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      })
    );
    expect(json.redirectTo).toBe("/dashboard");
    expect(json.loginType).toBe("dashboard_user");
  });

  it("opaque mode writes sessionId cookie instead of raw key", async () => {
    mockGetSessionTokenMode.mockReturnValue("opaque");
    mockCreateSession.mockResolvedValue({
      sessionId: "sid_opaque_session_cookie",
      keyFingerprint: "sha256:abcdef",
      userId: 1,
      userRole: "user",
      createdAt: 100,
      expiresAt: 200,
    });

    const res = await POST(makeRequest({ key: "opaque-key" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("sid_opaque_session_cookie");
    expect(mockSetAuthCookie).not.toHaveBeenCalledWith("opaque-key");
    expect(json.redirectTo).toBe("/dashboard");
    expect(json.loginType).toBe("dashboard_user");
  });

  it("dual mode remains successful when opaque session creation fails", async () => {
    mockGetSessionTokenMode.mockReturnValue("dual");
    mockCreateSession.mockRejectedValue(new Error("redis unavailable"));

    const res = await POST(makeRequest({ key: "dual-fallback-key" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockSetAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockSetAuthCookie).toHaveBeenCalledWith("dual-fallback-key");
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to create opaque session in dual mode",
      expect.objectContaining({
        error: expect.stringContaining("redis unavailable"),
      })
    );
  });

  it("all modes preserve readonly redirect semantics", async () => {
    mockValidateKey.mockResolvedValue(readonlySession);
    mockGetLoginRedirectTarget.mockReturnValue("/my-usage");

    const modes = ["legacy", "dual", "opaque"] as const;

    for (const mode of modes) {
      vi.clearAllMocks();
      mockGetSessionTokenMode.mockReturnValue(mode);
      mockValidateKey.mockResolvedValue(readonlySession);
      mockGetLoginRedirectTarget.mockReturnValue("/my-usage");
      mockSetAuthCookie.mockResolvedValue(undefined);
      mockCreateSession.mockResolvedValue({
        sessionId: `sid_${mode}_session`,
        keyFingerprint: "sha256:abcdef",
        userId: 2,
        userRole: "user",
        createdAt: 100,
        expiresAt: 200,
      });

      const res = await POST(makeRequest({ key: `${mode}-readonly-key` }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.redirectTo).toBe("/my-usage");
      expect(json.loginType).toBe("readonly_user");

      if (mode === "legacy") {
        expect(mockCreateSession).not.toHaveBeenCalled();
        expect(mockSetAuthCookie).toHaveBeenCalledWith("legacy-readonly-key");
      }

      if (mode === "dual") {
        expect(mockCreateSession).toHaveBeenCalledTimes(1);
        expect(mockSetAuthCookie).toHaveBeenCalledWith("dual-readonly-key");
      }

      if (mode === "opaque") {
        expect(mockCreateSession).toHaveBeenCalledTimes(1);
        expect(mockSetAuthCookie).toHaveBeenCalledWith("sid_opaque_session");
      }
    }
  });
});
