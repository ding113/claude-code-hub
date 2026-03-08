import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks
const mockCookies = vi.hoisted(() => vi.fn());
const mockHeaders = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockValidateApiKeyAndGetUser = vi.hoisted(() => vi.fn());
const mockFindKeyList = vi.hoisted(() => vi.fn());
const mockReadSession = vi.hoisted(() => vi.fn());
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));
const mockHeadersStore = vi.hoisted(() => ({
  get: vi.fn(),
}));
const mockConfig = vi.hoisted(() => ({
  auth: { adminToken: "test-admin-secret-token-12345" },
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/repository/key", () => ({
  validateApiKeyAndGetUser: mockValidateApiKeyAndGetUser,
  findKeyList: mockFindKeyList,
}));

vi.mock("@/lib/auth-session-store/redis-session-store", () => ({
  RedisSessionStore: class {
    read = mockReadSession;
    create = vi.fn();
    revoke = vi.fn();
    rotate = vi.fn();
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/config/config", () => ({
  config: mockConfig,
}));

function setSessionMode(mode: "legacy" | "dual" | "opaque") {
  mockGetEnvConfig.mockReturnValue({
    SESSION_TOKEN_MODE: mode,
    ENABLE_SECURE_COOKIES: false,
  });
}

function setAuthCookie(token?: string) {
  mockCookieStore.get.mockReturnValue(token ? { value: token } : undefined);
}

function setBearerHeader(token?: string) {
  mockHeadersStore.get.mockReturnValue(token ? `Bearer ${token}` : null);
}

describe("admin token opaque-mode fallback", () => {
  const ADMIN_TOKEN = "test-admin-secret-token-12345";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockCookies.mockResolvedValue(mockCookieStore);
    mockHeaders.mockResolvedValue(mockHeadersStore);
    mockHeadersStore.get.mockReturnValue(null);
    mockCookieStore.get.mockReturnValue(undefined);

    setSessionMode("opaque");
    mockReadSession.mockResolvedValue(null);
    mockFindKeyList.mockResolvedValue([]);
    mockValidateApiKeyAndGetUser.mockResolvedValue(null);
    mockConfig.auth.adminToken = ADMIN_TOKEN;
  });

  it("opaque mode + raw admin token via cookie -> auth succeeds", async () => {
    setAuthCookie(ADMIN_TOKEN);

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(-1);
    expect(session!.user.role).toBe("admin");
    expect(session!.key.name).toBe("ADMIN_TOKEN");
  });

  it("opaque mode + raw non-admin API key via cookie -> auth fails", async () => {
    setAuthCookie("sk-regular-user-key");
    // Even if this key is valid in DB, opaque mode must reject raw keys
    mockValidateApiKeyAndGetUser.mockResolvedValue({
      user: { id: 1, name: "user", role: "user", isEnabled: true },
      key: {
        id: 1,
        userId: 1,
        name: "key-1",
        key: "sk-regular-user-key",
        isEnabled: true,
        canLoginWebUi: true,
      },
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).toBeNull();
    // Must NOT fall back to validateApiKeyAndGetUser for non-admin keys
    expect(mockValidateApiKeyAndGetUser).not.toHaveBeenCalled();
  });

  it("opaque mode + admin token via Bearer header -> auth succeeds", async () => {
    // No cookie set; use Authorization header instead
    setBearerHeader(ADMIN_TOKEN);

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(-1);
    expect(session!.user.role).toBe("admin");
    expect(session!.key.name).toBe("ADMIN_TOKEN");
  });

  it("opaque mode + valid opaque session -> auth succeeds (original logic unchanged)", async () => {
    const crypto = await import("node:crypto");
    const keyString = "sk-opaque-source-key";
    const fingerprint = `sha256:${crypto.createHash("sha256").update(keyString, "utf8").digest("hex")}`;

    setAuthCookie("sid_valid_session");
    mockReadSession.mockResolvedValue({
      sessionId: "sid_valid_session",
      keyFingerprint: fingerprint,
      userId: 42,
      userRole: "user",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 86400_000,
    });
    mockFindKeyList.mockResolvedValue([
      {
        id: 1,
        userId: 42,
        name: "key-1",
        key: keyString,
        isEnabled: true,
        canLoginWebUi: true,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    mockValidateApiKeyAndGetUser.mockResolvedValue({
      user: {
        id: 42,
        name: "user-42",
        description: "test",
        role: "user",
        rpm: 100,
        dailyQuota: 100,
        providerGroup: null,
        tags: [],
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
        limit5hUsd: 0,
        limitWeeklyUsd: 0,
        limitMonthlyUsd: 0,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      key: {
        id: 1,
        userId: 42,
        name: "key-1",
        key: keyString,
        isEnabled: true,
        canLoginWebUi: true,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession({ allowReadOnlyAccess: true });

    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(42);
  });

  it("legacy mode -> behavior unchanged (admin token works via validateKey)", async () => {
    setSessionMode("legacy");
    setAuthCookie(ADMIN_TOKEN);

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(-1);
    expect(session!.user.role).toBe("admin");
    // Legacy mode should NOT touch opaque session store
    expect(mockReadSession).not.toHaveBeenCalled();
  });

  it("opaque mode + admin token not configured -> auth fails for raw token", async () => {
    mockConfig.auth.adminToken = "";
    setAuthCookie("some-random-token");

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).toBeNull();
  });
});
