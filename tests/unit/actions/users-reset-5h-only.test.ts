import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: vi.fn(async () => "en"),
}));

const emitActionAuditMock = vi.fn();
vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: (...args: unknown[]) => emitActionAuditMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const findUserByIdMock = vi.fn();
const updateUserCostResetMarkersMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
    updateUserCostResetMarkers: updateUserCostResetMarkersMock,
  };
});

const findKeyListMock = vi.fn();
vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    findKeyList: findKeyListMock,
  };
});

const clearUser5hCostCacheMock = vi.fn();
const clearUserCostCacheMock = vi.fn();
vi.mock("@/lib/redis/cost-cache-cleanup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis/cost-cache-cleanup")>();
  return {
    ...actual,
    clearUser5hCostCache: clearUser5hCostCacheMock,
    clearUserCostCache: clearUserCostCacheMock,
  };
});

const redisMock = {
  status: "ready",
};
const getRedisClientMock = vi.fn(() => redisMock);
vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

const invalidateCachedUserMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: invalidateCachedUserMock,
}));

const txDeleteWhereMock = vi.fn();
const txDeleteMock = vi.fn(() => ({ where: txDeleteWhereMock }));
const txUpdateWhereMock = vi.fn();
const txUpdateSetMock = vi.fn(() => ({ where: txUpdateWhereMock }));
const txUpdateMock = vi.fn(() => ({ set: txUpdateSetMock }));
const dbTransactionMock = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    delete: txDeleteMock,
    update: txUpdateMock,
  })
);

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: dbTransactionMock,
  },
}));

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

describe("resetUser5hLimitOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.status = "ready";
    invalidateCachedUserMock.mockResolvedValue(undefined);
    clearUser5hCostCacheMock.mockResolvedValue({
      costKeysDeleted: 1,
      leaseKeysDeleted: 1,
      durationMs: 4,
    });
    updateUserCostResetMarkersMock.mockResolvedValue(true);
    findKeyListMock.mockResolvedValue([{ id: 11, key: "sk-child-11" }]);
  });

  test("should return PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  test("rolling mode updates limit5hCostResetAt and clears rolling user cache only", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
    });

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(true);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledTimes(1);
    const markers = updateUserCostResetMarkersMock.mock.calls[0]?.[1];
    expect("costResetAt" in markers).toBe(false);
    expect(markers.limit5hCostResetAt).toBeInstanceOf(Date);
    expect(clearUser5hCostCacheMock).toHaveBeenCalledWith({
      userId: 123,
      resetMode: "rolling",
    });
    expect(clearUser5hCostCacheMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        keyIds: expect.anything(),
        keyHashes: expect.anything(),
      })
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
  });

  test("fixed mode fails when redis is unavailable", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
    });
    redisMock.status = "connecting";

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(updateUserCostResetMarkersMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  test("rolling mode also fails when redis is unavailable", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
    });
    redisMock.status = "connecting";

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      resetMode: "rolling",
      cleanupRequired: true,
    });
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
  });

  test("rolling mode keeps the marker and surfaces cleanupRequired when Redis cleanup fails", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
    });
    clearUser5hCostCacheMock.mockResolvedValue(null);

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      resetMode: "rolling",
      cleanupRequired: true,
    });
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledTimes(1);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        limit5hCostResetAt: expect.any(Date),
        enforceLimit5hMonotonic: true,
      })
    );
    expect(emitActionAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        after: expect.objectContaining({
          cleanupRequired: true,
          resetMode: "rolling",
        }),
      })
    );
  });

  test("fixed mode returns a dedicated cleanup failure error when Redis cleanup fails", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
    });
    clearUser5hCostCacheMock.mockResolvedValue(null);

    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );
    const result = await resetUser5hLimitOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.USER_5H_FIXED_RESET_CLEANUP_FAILED);
    expect(result.error).toBe("USER_5H_FIXED_RESET_CLEANUP_FAILED");
    expect(updateUserCostResetMarkersMock).not.toHaveBeenCalled();
    expect(emitActionAuditMock).not.toHaveBeenCalled();
  });
});

describe("full reset compatibility with user 5h marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCachedUserMock.mockResolvedValue(undefined);
    dbTransactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        delete: txDeleteMock,
        update: txUpdateMock,
      })
    );
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
      limit5hCostResetAt: new Date("2026-04-21T00:00:00.000Z"),
    });
    findKeyListMock.mockResolvedValue([{ id: 11, key: "sk-child-11" }]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 4,
      activeSessionsDeleted: 0,
      durationMs: 8,
    });
    updateUserCostResetMarkersMock.mockResolvedValue(true);
    txUpdateWhereMock.mockResolvedValue([{ id: 123 }]);
    txDeleteWhereMock.mockResolvedValue([]);
  });

  test("full reset still resets all amount windows and advances 5h marker", async () => {
    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledTimes(1);
    const markers = updateUserCostResetMarkersMock.mock.calls[0]?.[1];
    expect(markers.costResetAt).toBeInstanceOf(Date);
    expect(markers.limit5hCostResetAt).toBeInstanceOf(Date);
    expect(markers.limit5hCostResetAt.getTime()).toBe(markers.costResetAt.getTime());
    expect(clearUserCostCacheMock).toHaveBeenCalled();
  });

  test("full statistics reset does not leave stale 5h marker", async () => {
    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        costResetAt: null,
        limit5hCostResetAt: null,
      })
    );
    expect(invalidateCachedUserMock).toHaveBeenCalledWith(123);
  });

  test("full statistics reset fails when fixed 5h state exists but Redis is unavailable", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
    });
    findKeyListMock.mockResolvedValue([]);
    redisMock.status = "connecting";

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(txUpdateSetMock).not.toHaveBeenCalled();
  });

  test("full statistics reset fails when a child key has fixed 5h state and Redis is unavailable", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: null,
      limit5hResetMode: "rolling",
    });
    findKeyListMock.mockResolvedValue([
      {
        id: 11,
        key: "sk-child-11",
        limit5hUsd: 2,
        limit5hResetMode: "fixed",
      },
    ]);
    redisMock.status = "connecting";

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(txUpdateSetMock).not.toHaveBeenCalled();
  });
});
