import { beforeEach, describe, expect, it, vi } from "vitest";

const row = {
  keyId: 1,
  keyUserId: 2,
  keyString: "sk-test",
  keyName: "k1",
  keyIsEnabled: true,
  keyExpiresAt: null,
  keyCanLoginWebUi: true,
  keyLimit5hUsd: "1.00",
  keyLimitDailyUsd: "2.00",
  keyDailyResetMode: "fixed",
  keyDailyResetTime: "00:00",
  keyLimitWeeklyUsd: "3.00",
  keyLimitMonthlyUsd: "4.00",
  keyLimitTotalUsd: "5.00",
  keyLimitConcurrentSessions: 6,
  keyProviderGroup: "default",
  keyCacheTtlPreference: null,
  keyCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
  keyUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
  keyDeletedAt: null,
  userId: 2,
  userName: "u1",
  userDescription: "",
  userRole: "user",
  userRpm: 100,
  userDailyQuota: "10.00",
  userProviderGroup: "default",
  userLimit5hUsd: "1.25",
  userLimit5hResetMode: "rolling",
  userLimitWeeklyUsd: "2.5",
  userLimitMonthlyUsd: "3.75",
  userLimitTotalUsd: "20.00",
  userCostResetAt: new Date("2024-01-01T01:00:00.000Z"),
  userLimit5hCostResetAt: new Date("2024-01-01T02:00:00.000Z"),
  userLimitConcurrentSessions: 7,
  userDailyResetMode: "rolling",
  userDailyResetTime: "01:00",
  userIsEnabled: true,
  userExpiresAt: null,
  userAllowedClients: [],
  userAllowedModels: [],
  userCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
  userUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
  userDeletedAt: null,
};

const whereMock = vi.fn(async () => [row]);

const selectMock = vi.fn(() => ({
  from: vi.fn(() => ({
    innerJoin: vi.fn(() => ({
      where: whereMock,
    })),
  })),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  keys: {
    id: "keys.id",
    userId: "keys.userId",
    key: "keys.key",
    name: "keys.name",
    isEnabled: "keys.isEnabled",
    expiresAt: "keys.expiresAt",
    canLoginWebUi: "keys.canLoginWebUi",
    limit5hUsd: "keys.limit5hUsd",
    limitDailyUsd: "keys.limitDailyUsd",
    dailyResetMode: "keys.dailyResetMode",
    dailyResetTime: "keys.dailyResetTime",
    limitWeeklyUsd: "keys.limitWeeklyUsd",
    limitMonthlyUsd: "keys.limitMonthlyUsd",
    limitTotalUsd: "keys.limitTotalUsd",
    limitConcurrentSessions: "keys.limitConcurrentSessions",
    providerGroup: "keys.providerGroup",
    cacheTtlPreference: "keys.cacheTtlPreference",
    createdAt: "keys.createdAt",
    updatedAt: "keys.updatedAt",
    deletedAt: "keys.deletedAt",
  },
  users: {
    id: "users.id",
    name: "users.name",
    description: "users.description",
    role: "users.role",
    rpmLimit: "users.rpmLimit",
    dailyLimitUsd: "users.dailyLimitUsd",
    providerGroup: "users.providerGroup",
    limit5hUsd: "users.limit5hUsd",
    limit5hResetMode: "users.limit5hResetMode",
    limitWeeklyUsd: "users.limitWeeklyUsd",
    limitMonthlyUsd: "users.limitMonthlyUsd",
    limitTotalUsd: "users.limitTotalUsd",
    costResetAt: "users.costResetAt",
    limit5hCostResetAt: "users.limit5hCostResetAt",
    limitConcurrentSessions: "users.limitConcurrentSessions",
    dailyResetMode: "users.dailyResetMode",
    dailyResetTime: "users.dailyResetTime",
    isEnabled: "users.isEnabled",
    expiresAt: "users.expiresAt",
    allowedClients: "users.allowedClients",
    allowedModels: "users.allowedModels",
    createdAt: "users.createdAt",
    updatedAt: "users.updatedAt",
    deletedAt: "users.deletedAt",
  },
  messageRequest: {
    blockedBy: "messageRequest.blockedBy",
  },
  usageLedger: {
    blockedBy: "usageLedger.blockedBy",
    endpoint: "usageLedger.endpoint",
  },
}));

const authCache = vi.hoisted(() => ({
  getCachedActiveKey: vi.fn(),
  getCachedUser: vi.fn(),
  cacheAuthResult: vi.fn(async () => {}),
  cacheUser: vi.fn(async () => {}),
  invalidateCachedKey: vi.fn(async () => {}),
  cacheActiveKey: vi.fn(async () => {}),
  invalidateCachedUser: vi.fn(async () => {}),
}));
const vacuum = vi.hoisted(() => ({
  isDefinitelyNotPresent: vi.fn(() => true),
  noteExistingKey: vi.fn(),
}));
vi.mock("@/lib/security/api-key-auth-cache", () => authCache);
vi.mock("@/lib/security/api-key-vacuum-filter", () => ({ apiKeyVacuumFilter: vacuum }));

const sqlMock = (...args: unknown[]) => args;
sqlMock.join = (...args: unknown[]) => args;

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  gt: (...args: unknown[]) => args,
  isNull: (...args: unknown[]) => args,
  count: (...args: unknown[]) => args,
  desc: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  inArray: (...args: unknown[]) => args,
  lt: (...args: unknown[]) => args,
  sql: sqlMock,
  sum: (...args: unknown[]) => args,
}));

describe("repository/key validateApiKeyAndGetUser", () => {
  beforeEach(() => {
    vacuum.isDefinitelyNotPresent.mockReturnValue(false);
    authCache.getCachedActiveKey.mockResolvedValue(null);
    authCache.getCachedUser.mockResolvedValue(null);
    whereMock.mockResolvedValue([row]);
  });
  it("should return user with limit fields populated", async () => {
    const { validateApiKeyAndGetUser } = await import("@/repository/key");

    const result = await validateApiKeyAndGetUser("sk-test");

    expect(result?.user.limit5hUsd).toBe(1.25);
    expect(result?.user.limitWeeklyUsd).toBe(2.5);
    expect(result?.user.limitMonthlyUsd).toBe(3.75);
    expect(result?.user.limitTotalUsd).toBe(20);
    expect(result?.user.limit5hCostResetAt).toEqual(new Date("2024-01-01T02:00:00.000Z"));
    expect(result?.user.limitConcurrentSessions).toBe(7);
    expect(result?.user.dailyResetMode).toBe("rolling");
    expect(result?.user.dailyResetTime).toBe("01:00");
  });
});

describe("fresh catalog authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereMock.mockResolvedValue([row]);
    vacuum.isDefinitelyNotPresent.mockReturnValue(true);
    authCache.getCachedActiveKey.mockResolvedValue({ userId: row.userId });
    authCache.getCachedUser.mockResolvedValue({ id: row.userId, allowedModels: ["old"] });
  });

  it("bypasses both the vacuum filter and stale Redis permissions", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const result = await resolveApiKeyAuthOutcome("sk-test", { fresh: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.allowedModels).toEqual([]);
    expect(vacuum.isDefinitelyNotPresent).not.toHaveBeenCalled();
    expect(authCache.getCachedActiveKey).not.toHaveBeenCalled();
    expect(authCache.getCachedUser).not.toHaveBeenCalled();
    expect(authCache.cacheAuthResult).not.toHaveBeenCalled();
  });

  it.each([
    [[], "not_found"],
    [[{ ...row, keyIsEnabled: false }], "key_disabled"],
    [[{ ...row, keyExpiresAt: new Date(0) }], "key_expired"],
  ])(
    "preserves database failure classification despite a stale active key",
    async (rows, reason) => {
      whereMock.mockResolvedValueOnce(rows as (typeof row)[]);
      const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
      expect(await resolveApiKeyAuthOutcome("sk-test", { fresh: true })).toEqual({
        ok: false,
        reason,
      });
    }
  );

  it("still chooses an active duplicate key deterministically", async () => {
    whereMock.mockResolvedValueOnce([{ ...row, keyIsEnabled: false }, row]);
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const result = await resolveApiKeyAuthOutcome("sk-test", { fresh: true });
    expect(result.ok).toBe(true);
  });
});
