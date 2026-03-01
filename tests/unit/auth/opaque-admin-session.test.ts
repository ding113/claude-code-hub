import crypto from "node:crypto";
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
  auth: { adminToken: "test-admin-token-secret" },
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

function toFingerprint(keyString: string): string {
  return `sha256:${crypto.createHash("sha256").update(keyString, "utf8").digest("hex")}`;
}

describe("opaque session with admin token (userId=-1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockCookies.mockResolvedValue(mockCookieStore);
    mockHeaders.mockResolvedValue(mockHeadersStore);
    mockHeadersStore.get.mockReturnValue(null);
    mockCookieStore.get.mockReturnValue(undefined);

    mockGetEnvConfig.mockReturnValue({
      SESSION_TOKEN_MODE: "opaque",
      ENABLE_SECURE_COOKIES: false,
    });
    mockReadSession.mockResolvedValue(null);
    mockFindKeyList.mockResolvedValue([]);
    mockValidateApiKeyAndGetUser.mockResolvedValue(null);
    mockConfig.auth.adminToken = "test-admin-token-secret";
  });

  it("resolves admin session from opaque token with userId=-1", async () => {
    const adminToken = "test-admin-token-secret";
    mockCookieStore.get.mockReturnValue({ value: "sid_admin_test" });
    mockReadSession.mockResolvedValue({
      sessionId: "sid_admin_test",
      keyFingerprint: toFingerprint(adminToken),
      userId: -1,
      userRole: "admin",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 86400_000,
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.user.id).toBe(-1);
    expect(session!.user.role).toBe("admin");
    expect(session!.key.name).toBe("ADMIN_TOKEN");
    // Must NOT call findKeyList -- virtual admin user has no DB keys
    expect(mockFindKeyList).not.toHaveBeenCalled();
  });

  it("returns null when admin token is not configured but session has userId=-1", async () => {
    mockConfig.auth.adminToken = "";
    mockCookieStore.get.mockReturnValue({ value: "sid_admin_test" });
    mockReadSession.mockResolvedValue({
      sessionId: "sid_admin_test",
      keyFingerprint: toFingerprint("test-admin-token-secret"),
      userId: -1,
      userRole: "admin",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 86400_000,
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).toBeNull();
    expect(mockFindKeyList).not.toHaveBeenCalled();
  });

  it("returns null when fingerprint does not match admin token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "sid_admin_test" });
    mockReadSession.mockResolvedValue({
      sessionId: "sid_admin_test",
      keyFingerprint: toFingerprint("wrong-token"),
      userId: -1,
      userRole: "admin",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 86400_000,
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();

    expect(session).toBeNull();
    expect(mockFindKeyList).not.toHaveBeenCalled();
  });
});
