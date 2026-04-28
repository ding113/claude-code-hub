import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("auth scoped session branches", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockCookies.mockResolvedValue(mockCookieStore);
    mockHeaders.mockResolvedValue(mockHeadersStore);
    mockCookieStore.get.mockReturnValue(undefined);
    mockHeadersStore.get.mockReturnValue(null);
    mockGetEnvConfig.mockReturnValue({
      SESSION_TOKEN_MODE: "opaque",
      ENABLE_SECURE_COOKIES: false,
    });
    mockReadSession.mockResolvedValue(null);
    mockFindKeyList.mockResolvedValue([]);
    mockValidateApiKeyAndGetUser.mockResolvedValue(null);
  });

  it("rejects scoped readonly session when caller tries to access it without readonly permission", async () => {
    const { getSession, runWithAuthSession } = await import("@/lib/auth");

    const session = {
      user: { role: "user" },
      key: { canLoginWebUi: false },
    } as any;

    const result = await runWithAuthSession(
      session,
      () => getSession({ allowReadOnlyAccess: false }),
      { allowReadOnlyAccess: true }
    );

    expect(result).toBeNull();
  });

  it("allows legacy bearer token fallback in opaque mode for readonly self-service", async () => {
    mockHeadersStore.get.mockReturnValue("Bearer sk-readonly-fallback");
    mockValidateApiKeyAndGetUser.mockResolvedValue({
      user: {
        id: 1,
        name: "user",
        role: "user",
        isEnabled: true,
        expiresAt: null,
      },
      key: {
        id: 1,
        userId: 1,
        name: "readonly",
        key: "sk-readonly-fallback",
        isEnabled: true,
        canLoginWebUi: false,
      },
    });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession({ allowReadOnlyAccess: true });

    expect(session).not.toBeNull();
    expect(session?.key.key).toBe("sk-readonly-fallback");
    expect(mockValidateApiKeyAndGetUser).toHaveBeenCalledWith("sk-readonly-fallback");
  });
});
