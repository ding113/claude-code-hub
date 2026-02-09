import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

const isDefinitelyNotPresent = vi.fn(() => false);
const noteExistingKey = vi.fn();

const getCachedActiveKey = vi.fn();
const getCachedUser = vi.fn();

// 如果缓存路径未命中，这些 DB 调用会触发并让测试失败
vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
    insert: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
    update: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
  },
}));

vi.mock("@/lib/security/api-key-vacuum-filter", () => ({
  apiKeyVacuumFilter: {
    isDefinitelyNotPresent,
    noteExistingKey,
    startBackgroundReload: vi.fn(),
    invalidateAndReload: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  getCachedActiveKey,
  getCachedUser,
  cacheActiveKey: vi.fn(async () => {}),
  cacheAuthResult: vi.fn(async () => {}),
  cacheUser: vi.fn(async () => {}),
  invalidateCachedKey: vi.fn(async () => {}),
  invalidateCachedUser: vi.fn(async () => {}),
}));

function buildKey(overrides?: Partial<Key>): Key {
  const now = new Date("2026-02-08T00:00:00.000Z");
  return {
    id: 1,
    userId: 10,
    name: "k1",
    key: "sk-user-login",
    isEnabled: true,
    expiresAt: undefined,
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
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
    ...overrides,
  };
}

function buildUser(overrides?: Partial<User>): User {
  const now = new Date("2026-02-08T00:00:00.000Z");
  return {
    id: 10,
    name: "u1",
    description: "",
    role: "user",
    rpm: null,
    dailyQuota: null,
    providerGroup: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    allowedModels: [],
    ...overrides,
  };
}

describe("auth.ts：validateKey（Vacuum Filter -> Redis -> DB）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDefinitelyNotPresent.mockReturnValue(false);
    getCachedActiveKey.mockResolvedValue(null);
    getCachedUser.mockResolvedValue(null);
  });

  test("Redis key+user 命中时：validateKey 应不访问 DB 且返回 session（保护 login 侧热路径）", async () => {
    const cachedKey = buildKey({ key: "sk-user-login", canLoginWebUi: true, userId: 10 });
    const cachedUser = buildUser({ id: 10 });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);

    const { validateKey } = await import("@/lib/auth");
    await expect(validateKey("sk-user-login")).resolves.toEqual({ user: cachedUser, key: cachedKey });
    expect(isDefinitelyNotPresent).toHaveBeenCalledWith("sk-user-login");
  });

  test("用户禁用：缓存命中也应拒绝（保护登录/会话）", async () => {
    const cachedKey = buildKey({ key: "sk-user-disabled", canLoginWebUi: true, userId: 10 });
    const cachedUser = buildUser({ id: 10, isEnabled: false });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);

    const { validateKey } = await import("@/lib/auth");
    await expect(validateKey("sk-user-disabled")).resolves.toBeNull();
  });

  test("用户过期：缓存命中也应拒绝（保护登录/会话）", async () => {
    const cachedKey = buildKey({ key: "sk-user-expired", canLoginWebUi: true, userId: 10 });
    const cachedUser = buildUser({ id: 10, expiresAt: new Date("2000-01-01T00:00:00.000Z") });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);

    const { validateKey } = await import("@/lib/auth");
    await expect(validateKey("sk-user-expired")).resolves.toBeNull();
  });

  test("canLoginWebUi=false 且 allowReadOnlyAccess=false：缓存命中也应拒绝", async () => {
    const cachedKey = buildKey({ key: "sk-no-webui", canLoginWebUi: false, userId: 10 });
    const cachedUser = buildUser({ id: 10 });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);

    const { validateKey } = await import("@/lib/auth");
    await expect(validateKey("sk-no-webui", { allowReadOnlyAccess: false })).resolves.toBeNull();
  });

  test("allowReadOnlyAccess=true：应允许 canLoginWebUi=false 的 key 登录只读页面", async () => {
    const cachedKey = buildKey({ key: "sk-readonly", canLoginWebUi: false, userId: 10 });
    const cachedUser = buildUser({ id: 10 });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);

    const { validateKey } = await import("@/lib/auth");
    await expect(validateKey("sk-readonly", { allowReadOnlyAccess: true })).resolves.toEqual({
      user: cachedUser,
      key: cachedKey,
    });
  });
});
