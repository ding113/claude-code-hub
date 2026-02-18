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
  withNoStoreHeaders: (res: any) => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: (res: any) => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

function makeRequest(body: unknown, xForwardedProto = "https"): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-proto": xForwardedProto,
    },
    body: JSON.stringify(body),
  });
}

const adminSession = {
  user: {
    id: -1,
    name: "Admin Token",
    description: "Environment admin session",
    role: "admin" as const,
  },
  key: { canLoginWebUi: true },
};

const dashboardUserSession = {
  user: {
    id: 1,
    name: "Dashboard User",
    description: "dashboard",
    role: "user" as const,
  },
  key: { canLoginWebUi: true },
};

const readonlyUserSession = {
  user: {
    id: 2,
    name: "Readonly User",
    description: "readonly",
    role: "user" as const,
  },
  key: { canLoginWebUi: false },
};

describe("Login Regression Matrix", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");

    const mod = await import("../../../src/app/api/auth/login/route");
    POST = mod.POST;
  });

  describe("Success Paths", () => {
    it("admin user: redirectTo=/dashboard, loginType=admin", async () => {
      mockValidateKey.mockResolvedValue(adminSession);
      mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

      const res = await POST(makeRequest({ key: "admin-key" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: {
          id: -1,
          name: "Admin Token",
          description: "Environment admin session",
          role: "admin",
        },
        redirectTo: "/dashboard",
        loginType: "admin",
      });
      expect(mockSetAuthCookie).toHaveBeenCalledWith("admin-key");
      expect(mockGetLoginRedirectTarget).toHaveBeenCalledWith(adminSession);
    });

    it("dashboard user: redirectTo=/dashboard, loginType=dashboard_user", async () => {
      mockValidateKey.mockResolvedValue(dashboardUserSession);
      mockGetLoginRedirectTarget.mockReturnValue("/dashboard");

      const res = await POST(makeRequest({ key: "dashboard-user-key" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: {
          id: 1,
          name: "Dashboard User",
          description: "dashboard",
          role: "user",
        },
        redirectTo: "/dashboard",
        loginType: "dashboard_user",
      });
      expect(mockSetAuthCookie).toHaveBeenCalledWith("dashboard-user-key");
      expect(mockGetLoginRedirectTarget).toHaveBeenCalledWith(dashboardUserSession);
    });

    it("readonly user: redirectTo=/my-usage, loginType=readonly_user", async () => {
      mockValidateKey.mockResolvedValue(readonlyUserSession);
      mockGetLoginRedirectTarget.mockReturnValue("/my-usage");

      const res = await POST(makeRequest({ key: "readonly-user-key" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        user: {
          id: 2,
          name: "Readonly User",
          description: "readonly",
          role: "user",
        },
        redirectTo: "/my-usage",
        loginType: "readonly_user",
      });
      expect(mockSetAuthCookie).toHaveBeenCalledWith("readonly-user-key");
      expect(mockGetLoginRedirectTarget).toHaveBeenCalledWith(readonlyUserSession);
    });
  });

  describe("Failure Paths", () => {
    it("missing key: 400 + KEY_REQUIRED", async () => {
      const res = await POST(makeRequest({}));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "translated:apiKeyRequired",
        errorCode: "KEY_REQUIRED",
      });
      expect(mockValidateKey).not.toHaveBeenCalled();
      expect(mockSetAuthCookie).not.toHaveBeenCalled();
    });

    it("invalid key: 401 + KEY_INVALID", async () => {
      mockValidateKey.mockResolvedValue(null);

      const res = await POST(makeRequest({ key: "invalid-key" }));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "translated:apiKeyInvalidOrExpired",
        errorCode: "KEY_INVALID",
      });
      expect(mockSetAuthCookie).not.toHaveBeenCalled();
    });

    it("HTTP mismatch: 401 + httpMismatchGuidance", async () => {
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
      mockValidateKey.mockResolvedValue(null);

      const res = await POST(makeRequest({ key: "mismatch-key" }, "http"));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "translated:apiKeyInvalidOrExpired",
        errorCode: "KEY_INVALID",
        httpMismatchGuidance: "translated:cookieWarningDescription",
      });
      expect(mockSetAuthCookie).not.toHaveBeenCalled();
    });

    it("server error: 500 + SERVER_ERROR", async () => {
      mockValidateKey.mockRejectedValue(new Error("DB connection failed"));

      const res = await POST(makeRequest({ key: "trigger-server-error" }));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "translated:serverError",
        errorCode: "SERVER_ERROR",
      });
      expect(mockSetAuthCookie).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
