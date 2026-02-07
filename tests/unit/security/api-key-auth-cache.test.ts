import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

const isDefinitelyNotPresent = vi.fn(() => false);

const cacheActiveKey = vi.fn(async () => {});
const cacheAuthResult = vi.fn(async () => {});
const cacheUser = vi.fn(async () => {});
const getCachedActiveKey = vi.fn<Parameters<(keyString: string) => Promise<Key | null>>, Promise<Key | null>>();
const getCachedUser = vi.fn<Parameters<(userId: number) => Promise<User | null>>, Promise<User | null>>();
const invalidateCachedKey = vi.fn(async () => {});

const dbSelect = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

vi.mock("@/lib/security/api-key-vacuum-filter", () => ({
  apiKeyVacuumFilter: {
    isDefinitelyNotPresent,
    noteExistingKey: vi.fn(),
    startBackgroundReload: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  cacheActiveKey,
  cacheAuthResult,
  cacheUser,
  getCachedActiveKey,
  getCachedUser,
  invalidateCachedKey,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
    update: dbUpdate,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  isDefinitelyNotPresent.mockReturnValue(false);
  getCachedActiveKey.mockResolvedValue(null);
  getCachedUser.mockResolvedValue(null);
  dbSelect.mockImplementation(() => {
    throw new Error("DB_ACCESS");
  });
  dbInsert.mockImplementation(() => {
    throw new Error("DB_ACCESS");
  });
  dbUpdate.mockImplementation(() => {
    throw new Error("DB_ACCESS");
  });
});

function buildKey(overrides?: Partial<Key>): Key {
  return {
    id: 1,
    userId: 10,
    name: "k1",
    key: "sk-test",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: undefined,
    ...overrides,
  };
}

function buildUser(overrides?: Partial<User>): User {
  return {
    id: 10,
    name: "u1",
    description: "",
    role: "user",
    rpm: null,
    dailyQuota: null,
    providerGroup: null,
    tags: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: undefined,
    limit5hUsd: undefined,
    limitWeeklyUsd: undefined,
    limitMonthlyUsd: undefined,
    limitTotalUsd: null,
    limitConcurrentSessions: undefined,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    allowedModels: [],
    ...overrides,
  };
}

describe("API Key 鉴权缓存：VacuumFilter -> Redis -> DB", () => {
  test("findActiveKeyByKeyString：Redis 命中时应避免打 DB", async () => {
    const cachedKey = buildKey({ key: "sk-cached" });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    dbSelect.mockImplementation(() => {
      throw new Error("DB_ACCESS");
    });

    const { findActiveKeyByKeyString } = await import("@/repository/key");
    await expect(findActiveKeyByKeyString("sk-cached")).resolves.toEqual(cachedKey);
    expect(getCachedActiveKey).toHaveBeenCalledWith("sk-cached");
    expect(dbSelect).not.toHaveBeenCalled();
  });

  test("validateApiKeyAndGetUser：key+user Redis 命中时应避免打 DB", async () => {
    const cachedKey = buildKey({ key: "sk-cached", userId: 10 });
    const cachedUser = buildUser({ id: 10 });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(cachedUser);
    dbSelect.mockImplementation(() => {
      throw new Error("DB_ACCESS");
    });

    const { validateApiKeyAndGetUser } = await import("@/repository/key");
    await expect(validateApiKeyAndGetUser("sk-cached")).resolves.toEqual({
      user: cachedUser,
      key: cachedKey,
    });
    expect(getCachedActiveKey).toHaveBeenCalledWith("sk-cached");
    expect(getCachedUser).toHaveBeenCalledWith(10);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  test("validateApiKeyAndGetUser：key Redis 命中 + user miss 时应只查 user 并写回缓存", async () => {
    const cachedKey = buildKey({ key: "sk-cached", userId: 10 });
    getCachedActiveKey.mockResolvedValueOnce(cachedKey);
    getCachedUser.mockResolvedValueOnce(null);

    const userRow = {
      id: 10,
      name: "u1",
      description: "",
      role: "user",
      rpm: null,
      dailyQuota: null,
      providerGroup: null,
      tags: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      deletedAt: null,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
    };

    dbSelect.mockReturnValueOnce({
      from: () => ({
        where: async () => [userRow],
      }),
    });

    const { validateApiKeyAndGetUser } = await import("@/repository/key");
    const result = await validateApiKeyAndGetUser("sk-cached");
    expect(result?.key).toEqual(cachedKey);
    expect(result?.user.id).toBe(10);
    expect(cacheUser).toHaveBeenCalledTimes(1);
    expect(cacheAuthResult).not.toHaveBeenCalled();
  });

  test("validateApiKeyAndGetUser：缓存未命中时应走 DB join 并写入 auth 缓存", async () => {
    getCachedActiveKey.mockResolvedValueOnce(null);

    const joinRow = {
      keyId: 1,
      keyUserId: 10,
      keyString: "sk-db",
      keyName: "k1",
      keyIsEnabled: true,
      keyExpiresAt: null,
      keyCanLoginWebUi: true,
      keyLimit5hUsd: null,
      keyLimitDailyUsd: null,
      keyDailyResetMode: "fixed",
      keyDailyResetTime: "00:00",
      keyLimitWeeklyUsd: null,
      keyLimitMonthlyUsd: null,
      keyLimitTotalUsd: null,
      keyLimitConcurrentSessions: 0,
      keyProviderGroup: null,
      keyCacheTtlPreference: null,
      keyCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      keyUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
      keyDeletedAt: null,
      userId: 10,
      userName: "u1",
      userDescription: "",
      userRole: "user",
      userRpm: null,
      userDailyQuota: null,
      userProviderGroup: null,
      userLimit5hUsd: null,
      userLimitWeeklyUsd: null,
      userLimitMonthlyUsd: null,
      userLimitTotalUsd: null,
      userLimitConcurrentSessions: null,
      userDailyResetMode: "fixed",
      userDailyResetTime: "00:00",
      userIsEnabled: true,
      userExpiresAt: null,
      userAllowedClients: [],
      userAllowedModels: [],
      userCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
      userDeletedAt: null,
    };

    dbSelect.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          where: async () => [joinRow],
        }),
      }),
    });

    const { validateApiKeyAndGetUser } = await import("@/repository/key");
    const result = await validateApiKeyAndGetUser("sk-db");
    expect(result?.key.key).toBe("sk-db");
    expect(result?.user.id).toBe(10);
    expect(cacheAuthResult).toHaveBeenCalledTimes(1);
  });
});

describe("API Key 鉴权缓存：写入/失效点覆盖", () => {
  test("updateKey：应触发 cacheActiveKey", async () => {
    const keyRow = {
      id: 1,
      userId: 10,
      key: "sk-update",
      name: "k1",
      isEnabled: true,
      expiresAt: null,
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
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      deletedAt: null,
    };

    dbUpdate.mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [keyRow],
        }),
      }),
    });

    const { updateKey } = await import("@/repository/key");
    const updated = await updateKey(1, { name: "k2" });
    expect(updated?.key).toBe("sk-update");
    expect(cacheActiveKey).toHaveBeenCalledTimes(1);
  });

  test("deleteKey：删除成功时应触发 invalidateCachedKey", async () => {
    dbUpdate.mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [{ id: 1, key: "sk-deleted" }],
        }),
      }),
    });

    const { deleteKey } = await import("@/repository/key");
    await expect(deleteKey(1)).resolves.toBe(true);
    expect(invalidateCachedKey).toHaveBeenCalledWith("sk-deleted");
  });
});
