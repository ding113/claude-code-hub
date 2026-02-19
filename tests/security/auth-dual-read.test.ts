import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

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
const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
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
  logger: loggerMock,
}));

vi.mock("@/lib/config/config", () => ({
  config: { auth: { adminToken: "" } },
}));

function setSessionMode(mode: "legacy" | "dual" | "opaque") {
  mockGetEnvConfig.mockReturnValue({
    SESSION_TOKEN_MODE: mode,
    ENABLE_SECURE_COOKIES: false,
  });
}

function setAuthToken(token?: string) {
  mockCookieStore.get.mockReturnValue(token ? { value: token } : undefined);
}

function toFingerprint(keyString: string): string {
  return `sha256:${crypto.createHash("sha256").update(keyString, "utf8").digest("hex")}`;
}

function buildUser(id: number): User {
  const now = new Date("2026-02-18T10:00:00.000Z");
  return {
    id,
    name: `user-${id}`,
    description: "test user",
    role: "user",
    rpm: 100,
    dailyQuota: 100,
    providerGroup: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    limit5hUsd: 0,
    limitWeeklyUsd: 0,
    limitMonthlyUsd: 0,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    allowedModels: [],
  };
}

function buildKey(id: number, userId: number, keyString: string, canLoginWebUi = true): Key {
  const now = new Date("2026-02-18T10:00:00.000Z");
  return {
    id,
    userId,
    name: `key-${id}`,
    key: keyString,
    isEnabled: true,
    canLoginWebUi,
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
    createdAt: now,
    updatedAt: now,
  };
}

function buildAuthResult(keyString: string, userId = 1) {
  return {
    user: buildUser(userId),
    key: buildKey(userId, userId, keyString),
  };
}

describe("auth dual-read session resolver", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockCookies.mockResolvedValue(mockCookieStore);
    mockHeaders.mockResolvedValue(mockHeadersStore);
    mockHeadersStore.get.mockReturnValue(null);
    mockCookieStore.get.mockReturnValue(undefined);

    setSessionMode("legacy");
    mockReadSession.mockResolvedValue(null);
    mockFindKeyList.mockResolvedValue([]);
    mockValidateApiKeyAndGetUser.mockResolvedValue(null);
  });

  it("legacy mode keeps legacy key validation path unchanged", async () => {
    setSessionMode("legacy");
    setAuthToken("sk-legacy");
    const authResult = buildAuthResult("sk-legacy", 11);
    mockValidateApiKeyAndGetUser.mockResolvedValue(authResult);

    const { getSessionWithDualRead } = await import("@/lib/auth");
    const session = await getSessionWithDualRead();

    expect(session).toEqual(authResult);
    expect(mockReadSession).not.toHaveBeenCalled();
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledWith("sk-legacy");
  });

  it("dual mode tries opaque read first and then falls back to legacy cookie", async () => {
    setSessionMode("dual");
    setAuthToken("sk-dual");
    const authResult = buildAuthResult("sk-dual", 12);
    mockReadSession.mockResolvedValue(null);
    mockValidateApiKeyAndGetUser.mockResolvedValue(authResult);

    const { getSessionWithDualRead } = await import("@/lib/auth");
    const session = await getSessionWithDualRead();

    expect(session).toEqual(authResult);
    expect(mockReadSession).toHaveBeenCalledTimes(1);
    expect(mockReadSession).toHaveBeenCalledWith("sk-dual");
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledWith("sk-dual");
    expect(mockReadSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockValidateApiKeyAndGetUser.mock.invocationCallOrder[0]
    );
  });

  it("opaque mode only reads opaque session and never falls back to legacy", async () => {
    setSessionMode("opaque");
    setAuthToken("sk-legacy-in-opaque");
    mockReadSession.mockResolvedValue(null);
    mockValidateApiKeyAndGetUser.mockResolvedValue(buildAuthResult("sk-legacy-in-opaque", 13));

    const { getSessionWithDualRead } = await import("@/lib/auth");
    const session = await getSessionWithDualRead();

    expect(session).toBeNull();
    expect(mockReadSession).toHaveBeenCalledTimes(1);
    expect(mockReadSession).toHaveBeenCalledWith("sk-legacy-in-opaque");
    expect(mockValidateApiKeyAndGetUser).not.toHaveBeenCalled();
  });

  it("returns a valid auth session when opaque session is found", async () => {
    setSessionMode("dual");
    setAuthToken("sid_opaque_found");

    const keyString = "sk-opaque-source";
    const authResult = buildAuthResult(keyString, 21);
    mockReadSession.mockResolvedValue({
      sessionId: "sid_opaque_found",
      keyFingerprint: toFingerprint(keyString),
      userId: 21,
      userRole: "user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    });
    mockFindKeyList.mockResolvedValue([
      buildKey(1, 21, "sk-not-match"),
      buildKey(2, 21, keyString),
    ]);
    mockValidateApiKeyAndGetUser.mockResolvedValue(authResult);

    const { getSessionWithDualRead } = await import("@/lib/auth");
    const session = await getSessionWithDualRead({ allowReadOnlyAccess: true });

    expect(session).toEqual(authResult);
    expect(mockReadSession).toHaveBeenCalledWith("sid_opaque_found");
    expect(mockFindKeyList).toHaveBeenCalledWith(21);
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledWith(keyString);
  });

  it("validateSession falls back to legacy path when opaque session is missing in dual mode", async () => {
    setSessionMode("dual");
    setAuthToken("sk-dual-fallback");
    const authResult = buildAuthResult("sk-dual-fallback", 22);
    mockReadSession.mockResolvedValue(null);
    mockValidateApiKeyAndGetUser.mockResolvedValue(authResult);

    const { validateSession } = await import("@/lib/auth");
    const session = await validateSession();

    expect(session).toEqual(authResult);
    expect(mockReadSession).toHaveBeenCalledTimes(1);
    expect(mockReadSession).toHaveBeenCalledWith("sk-dual-fallback");
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledWith("sk-dual-fallback");
  });

  it("dual mode gracefully falls back to legacy when opaque session store read fails", async () => {
    setSessionMode("dual");
    setAuthToken("sk-store-error");
    const authResult = buildAuthResult("sk-store-error", 23);
    mockReadSession.mockRejectedValue(new Error("redis unavailable"));
    mockValidateApiKeyAndGetUser.mockResolvedValue(authResult);

    const { getSessionWithDualRead } = await import("@/lib/auth");
    const session = await getSessionWithDualRead();

    expect(session).toEqual(authResult);
    expect(mockReadSession).toHaveBeenCalledTimes(1);
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Opaque session read failed",
      expect.objectContaining({
        error: expect.stringContaining("redis unavailable"),
      })
    );
  });
});
