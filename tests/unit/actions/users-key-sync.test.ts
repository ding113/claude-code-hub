import { beforeEach, describe, expect, test, vi } from "vitest";
import { keys as keysTable, users as usersTable } from "@/drizzle/schema";
import { ERROR_CODES } from "@/lib/utils/error-messages";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const createUserMock = vi.fn();
const updateUserMock = vi.fn();
vi.mock("@/repository/user", () => ({
  createUser: createUserMock,
  deleteUser: vi.fn(),
  findUserById: vi.fn(),
  findUserListBatch: vi.fn(),
  getAllUserProviderGroups: vi.fn(),
  getAllUserTags: vi.fn(),
  resetUserCostResetAt: vi.fn(),
  searchUsersForFilter: vi.fn(),
  updateUser: updateUserMock,
}));

const createKeyMock = vi.fn();
vi.mock("@/repository/key", () => ({
  createKey: createKeyMock,
  findKeyList: vi.fn(async () => []),
  findKeyListBatch: vi.fn(async () => new Map()),
  findKeysStatisticsBatchFromKeys: vi.fn(async () => new Map()),
  findKeyUsageTodayBatch: vi.fn(async () => new Map()),
}));

const invalidateCachedKeyMock = vi.fn();
const invalidateCachedUserMock = vi.fn();
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedKey: invalidateCachedKeyMock,
  invalidateCachedUser: invalidateCachedUserMock,
}));

const userReturningMock = vi.fn();
const batchUserRowsOrderByMock = vi.fn();
const keyRowsOrderByMock = vi.fn();
const userUpdatePayloads: Array<Record<string, unknown>> = [];
const keyUpdatePayloads: Array<Record<string, unknown>> = [];
const dbTransactionMock = vi.fn(async (fn: (tx: any) => Promise<void>) => {
  const tx = {
    update: vi.fn((table) => ({
      set: vi.fn((payload) => {
        if (table === usersTable) {
          userUpdatePayloads.push(payload);
          return {
            where: vi.fn(() => ({
              returning: userReturningMock,
            })),
          };
        }

        keyUpdatePayloads.push(payload);
        return {
          where: vi.fn(async () => undefined),
        };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table === usersTable) {
          return {
            where: vi.fn(() => ({
              orderBy: batchUserRowsOrderByMock,
            })),
          };
        }

        expect(table).toBe(keysTable);
        return {
          where: vi.fn(() => ({
            orderBy: keyRowsOrderByMock,
          })),
        };
      }),
    })),
  };
  await fn(tx);
});

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: dbTransactionMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("users key sync actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userUpdatePayloads.length = 0;
    keyUpdatePayloads.length = 0;
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    invalidateCachedKeyMock.mockResolvedValue(undefined);
    invalidateCachedUserMock.mockResolvedValue(undefined);
  });

  test("addUser creates the default key with user limits", async () => {
    createUserMock.mockResolvedValue({
      id: 10,
      name: "alice",
      description: "",
      role: "user",
      isEnabled: true,
      expiresAt: null,
      rpm: 0,
      dailyQuota: 100,
      providerGroup: "fast",
      tags: [],
      limit5hUsd: 10,
      limitWeeklyUsd: 200,
      limitMonthlyUsd: 500,
      limitTotalUsd: 1000,
      limitConcurrentSessions: 3,
      limit5hResetMode: "fixed",
      dailyResetMode: "rolling",
      dailyResetTime: "18:30",
      allowedModels: [],
    });
    createKeyMock.mockResolvedValue({ id: 20, name: "default" });

    const { addUser } = await import("@/actions/users");
    const result = await addUser({
      name: "alice",
      providerGroup: "fast",
      dailyQuota: 100,
      limit5hUsd: 10,
      limitWeeklyUsd: 200,
      limitMonthlyUsd: 500,
      limitTotalUsd: 1000,
      limitConcurrentSessions: 3,
      dailyResetMode: "rolling",
      dailyResetTime: "18:30",
    });

    expect(result.ok).toBe(true);
    expect(createKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 10,
        name: "default",
        limit_5h_usd: 10,
        limit_5h_reset_mode: "fixed",
        limit_daily_usd: 100,
        limit_weekly_usd: 200,
        limit_monthly_usd: 500,
        limit_total_usd: 1000,
        limit_concurrent_sessions: 3,
        provider_group: "fast",
        daily_reset_mode: "rolling",
        daily_reset_time: "18:30",
      })
    );
  });

  test("syncUserConfigToKeys saves user and updates all undeleted keys by created order", async () => {
    userReturningMock.mockResolvedValue([
      {
        id: 10,
        dailyQuota: "100.00",
        providerGroup: "fast",
        limit5hUsd: "0.02",
        limit5hResetMode: "fixed",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 2,
        dailyResetMode: "rolling",
        dailyResetTime: "18:30",
      },
    ]);
    keyRowsOrderByMock.mockResolvedValue([
      { id: 1, key: "sk-1" },
      { id: 2, key: "sk-2" },
      { id: 3, key: "sk-3" },
    ]);

    const { syncUserConfigToKeys } = await import("@/actions/users");
    const result = await syncUserConfigToKeys(10, {
      name: "alice",
      providerGroup: "fast",
      dailyQuota: 100,
      limit5hUsd: 0.02,
      limitConcurrentSessions: 2,
      limit5hResetMode: "fixed",
      dailyResetMode: "rolling",
      dailyResetTime: "18:30",
    });

    expect(result.ok).toBe(true);
    expect(keyUpdatePayloads).toHaveLength(3);
    expect(keyUpdatePayloads.map((payload) => payload.limitDailyUsd)).toEqual([
      "33.33",
      "33.33",
      "33.33",
    ]);
    expect(keyUpdatePayloads.map((payload) => payload.limit5hUsd)).toEqual(["0.01", "0.01", null]);
    expect(keyUpdatePayloads.every((payload) => payload.limit5hResetMode === "fixed")).toBe(true);
    expect(keyUpdatePayloads.map((payload) => payload.limitConcurrentSessions)).toEqual([1, 1, 0]);
    expect(keyUpdatePayloads.every((payload) => payload.providerGroup === "fast")).toBe(true);
    expect(keyUpdatePayloads.every((payload) => payload.dailyResetMode === "rolling")).toBe(true);
    expect(keyUpdatePayloads.every((payload) => payload.dailyResetTime === "18:30")).toBe(true);
    expect(keyUpdatePayloads.some((payload) => "canLoginWebUi" in payload)).toBe(false);
    expect(keyUpdatePayloads.some((payload) => "name" in payload)).toBe(false);
    expect(keyUpdatePayloads.some((payload) => "expiresAt" in payload)).toBe(false);
    expect(keyUpdatePayloads.some((payload) => "cacheTtlPreference" in payload)).toBe(false);
    expect(invalidateCachedUserMock).toHaveBeenCalledWith(10);
    expect(invalidateCachedKeyMock).toHaveBeenCalledTimes(3);
  });

  test("batchSyncUserConfigToKeys saves batch user fields and syncs keys per user", async () => {
    batchUserRowsOrderByMock.mockResolvedValue([
      {
        id: 10,
        dailyQuota: "100.00",
        providerGroup: "fast",
        limit5hUsd: "0.02",
        limit5hResetMode: "fixed",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 2,
        dailyResetMode: "rolling",
        dailyResetTime: "18:30",
      },
      {
        id: 11,
        dailyQuota: null,
        providerGroup: "slow",
        limit5hUsd: null,
        limit5hResetMode: "rolling",
        limitWeeklyUsd: "9.00",
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
      },
    ]);
    keyRowsOrderByMock.mockResolvedValue([
      { id: 1, key: "sk-1", userId: 10 },
      { id: 2, key: "sk-2", userId: 10 },
      { id: 3, key: "sk-3", userId: 10 },
      { id: 4, key: "sk-4", userId: 11 },
    ]);

    const { batchSyncUserConfigToKeys } = await import("@/actions/users");
    const result = await batchSyncUserConfigToKeys({
      userIds: [10, 11],
      updates: {
        note: "batch-note",
        dailyQuota: 100,
        limit5hUsd: 0.02,
        limit5hResetMode: "fixed",
      },
    });

    expect(result.ok).toBe(true);
    expect(userUpdatePayloads[0]).toMatchObject({
      description: "batch-note",
      dailyLimitUsd: "100",
      limit5hUsd: "0.02",
      limit5hResetMode: "fixed",
    });
    expect(keyUpdatePayloads).toHaveLength(4);
    expect(keyUpdatePayloads.slice(0, 3).map((payload) => payload.limitDailyUsd)).toEqual([
      "33.33",
      "33.33",
      "33.33",
    ]);
    expect(keyUpdatePayloads.slice(0, 3).map((payload) => payload.limit5hUsd)).toEqual([
      "0.01",
      "0.01",
      null,
    ]);
    expect(keyUpdatePayloads.slice(0, 3).map((payload) => payload.limitConcurrentSessions)).toEqual(
      [1, 1, 0]
    );
    expect(keyUpdatePayloads[3]).toMatchObject({
      limitDailyUsd: null,
      limitWeeklyUsd: "9",
      limitConcurrentSessions: 0,
      providerGroup: "slow",
      limit5hResetMode: "rolling",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
    });
    expect(invalidateCachedUserMock).toHaveBeenCalledWith(10);
    expect(invalidateCachedUserMock).toHaveBeenCalledWith(11);
    expect(invalidateCachedKeyMock).toHaveBeenCalledTimes(4);
  });

  test("syncUserConfigToKeys rejects non-admin users", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

    const { syncUserConfigToKeys } = await import("@/actions/users");
    const result = await syncUserConfigToKeys(10, { name: "alice" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    }
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });
});
