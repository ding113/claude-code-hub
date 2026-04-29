import type { AuthSession } from "@/lib/auth";
import { afterEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getProvidersMock = vi.hoisted(() => vi.fn());
const redisReadMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
  level: "debug",
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "db-admin-key", canLoginWebUi: true },
} as AuthSession;

describe("v1 API key admin access flag", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/actions/providers");
    vi.doUnmock("@/lib/auth-session-store/redis-session-store");
    vi.resetModules();
  });

  test("allows admin user API keys on admin routes only when the flag is enabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProvidersMock.mockResolvedValue([]);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/providers", () => ({ getProviders: getProvidersMock }));

    const { callV1Route } = await import("../../../api/v1/test-utils");
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer db-admin-key" },
    });

    expect(got.response.status).toBe(200);
    expect(got.json).toEqual({ items: [] });
    expect(getProvidersMock).toHaveBeenCalled();
  });

  test("allows opaque admin-token cookies on admin routes when API key admin access is disabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockResolvedValue({
      sessionId: "sid_admin",
      keyFingerprint: "sha256:admin",
      credentialType: "admin-token",
      userId: -1,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    getProvidersMock.mockResolvedValue([]);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createCookieAuthContext("sid_admin"), "admin");

    expect(got).not.toBeInstanceOf(Response);
    expect(got).toMatchObject({ credentialType: "admin-token", source: "cookie" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_admin");
  });

  test("allows opaque browser session cookies on admin routes when API key admin access is disabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockResolvedValue({
      sessionId: "sid_browser_admin",
      keyFingerprint: "sha256:browser",
      credentialType: "session",
      userId: 1,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createCookieAuthContext("sid_browser_admin"), "admin");

    expect(got).not.toBeInstanceOf(Response);
    expect(got).toMatchObject({ credentialType: "session", source: "cookie" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_browser_admin");
  });

  test("allows legacy opaque browser cookies without credential provenance on admin routes", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockResolvedValue({
      sessionId: "sid_legacy_browser_admin",
      keyFingerprint: "sha256:legacy-browser",
      credentialType: "session",
      userId: 1,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createCookieAuthContext("sid_legacy_browser_admin"), "admin");

    expect(got).not.toBeInstanceOf(Response);
    expect(got).toMatchObject({ credentialType: "session", source: "cookie" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_legacy_browser_admin");
  });

  test("allows legacy cookie admin sessions on admin routes when API key admin access is disabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    vi.stubEnv("SESSION_TOKEN_MODE", "legacy");
    validateAuthTokenMock.mockResolvedValue(adminSession);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createCookieAuthContext("db-admin-key"), "admin");

    expect(got).not.toBeInstanceOf(Response);
    expect(got).toMatchObject({ credentialType: "session", source: "cookie" });
    expect(validateAuthTokenMock).toHaveBeenCalledWith("db-admin-key", {
      allowReadOnlyAccess: false,
    });
    expect(redisReadMock).not.toHaveBeenCalled();
  });

  test("rejects opaque user API key bearer tokens at the v1 route layer when admin access is disabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockResolvedValue({
      sessionId: "sid_user_route",
      keyFingerprint: "sha256:user",
      credentialType: "user-api-key",
      userId: 1,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    getProvidersMock.mockResolvedValue([]);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    vi.doMock("@/actions/providers", () => ({ getProviders: getProvidersMock }));

    const { app } = await import("@/app/api/v1/_root/app");
    const response = await app.request("http://localhost/api/v1/providers", {
      method: "GET",
      headers: { Authorization: "Bearer sid_user_route" },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorCode: "auth.api_key_admin_disabled" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_user_route");
    expect(getProvidersMock).not.toHaveBeenCalled();
  });

  test("classifies opaque lookup failures as user API keys before admin route gating", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockRejectedValue(new Error("redis unavailable"));

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createBearerAuthContext("sid_broken"), "admin");
    const body = got instanceof Response ? await got.json() : null;

    expect(got).toBeInstanceOf(Response);
    expect((got as Response).status).toBe(403);
    expect(body).toMatchObject({ errorCode: "auth.api_key_admin_disabled" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_broken");
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[V1Auth] Failed to classify opaque session credential",
      { error: "redis unavailable" }
    );
  });

  test("rejects opaque user API key cookies on admin routes when API key admin access is disabled", async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "false");
    validateAuthTokenMock.mockResolvedValue(adminSession);
    redisReadMock.mockResolvedValue({
      sessionId: "sid_user",
      keyFingerprint: "sha256:user",
      credentialType: "user-api-key",
      userId: 1,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    getProvidersMock.mockResolvedValue([]);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));
    const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
    const got = await resolveAuth(createCookieAuthContext("sid_user"), "admin");
    const body = got instanceof Response ? await got.json() : null;

    expect(got).toBeInstanceOf(Response);
    expect((got as Response).status).toBe(403);
    expect(body).toMatchObject({ errorCode: "auth.api_key_admin_disabled" });
    expect(redisReadMock).toHaveBeenCalledWith("sid_user");
  });
});

function createCookieAuthContext(token: string) {
  const headers = new Headers({ Cookie: `auth-token=${token}` });
  return {
    req: {
      method: "GET",
      url: "http://localhost/api/v1/providers",
      raw: { headers },
      header: (name: string) => headers.get(name) ?? undefined,
    },
  } as never;
}

function createBearerAuthContext(token: string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  return {
    req: {
      method: "GET",
      url: "http://localhost/api/v1/providers",
      raw: { headers },
      header: (name: string) => headers.get(name) ?? undefined,
    },
  } as never;
}
