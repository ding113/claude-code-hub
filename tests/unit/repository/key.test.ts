import { describe, expect, it, vi } from "vitest";

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
  userLimitWeeklyUsd: "2.5",
  userLimitMonthlyUsd: "3.75",
  userLimitTotalUsd: "20.00",
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

const selectMock = vi.fn(() => ({
  from: vi.fn(() => ({
    innerJoin: vi.fn(() => ({
      where: vi.fn(async () => [row]),
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
    limitWeeklyUsd: "users.limitWeeklyUsd",
    limitMonthlyUsd: "users.limitMonthlyUsd",
    limitTotalUsd: "users.limitTotalUsd",
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
}));

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
  sql: (...args: unknown[]) => args,
  sum: (...args: unknown[]) => args,
}));

describe("repository/key validateApiKeyAndGetUser", () => {
  it("should return user with limit fields populated", async () => {
    const { validateApiKeyAndGetUser } = await import("@/repository/key");

    const result = await validateApiKeyAndGetUser("sk-test");

    expect(result?.user.limit5hUsd).toBe(1.25);
    expect(result?.user.limitWeeklyUsd).toBe(2.5);
    expect(result?.user.limitMonthlyUsd).toBe(3.75);
    expect(result?.user.limitTotalUsd).toBe(20);
    expect(result?.user.limitConcurrentSessions).toBe(7);
    expect(result?.user.dailyResetMode).toBe("rolling");
    expect(result?.user.dailyResetTime).toBe("01:00");
  });
});
