import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

// Mock getSession
const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

// Mock next-intl
const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: vi.fn(async () => "en"),
}));

// Mock next/cache
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// Mock repository/user
const findUserByIdMock = vi.fn();
const resetUserCostResetAtMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
    resetUserCostResetAt: resetUserCostResetAtMock,
  };
});

// Mock repository/key
const findKeyListMock = vi.fn();
vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    findKeyList: findKeyListMock,
  };
});

// Mock drizzle db - need update().set().where() chain
const dbUpdateWhereMock = vi.fn();
const dbUpdateSetMock = vi.fn(() => ({ where: dbUpdateWhereMock }));
const dbUpdateMock = vi.fn(() => ({ set: dbUpdateSetMock }));
const dbDeleteWhereMock = vi.fn();
const dbDeleteMock = vi.fn(() => ({ where: dbDeleteWhereMock }));
vi.mock("@/drizzle/db", () => ({
  db: {
    update: dbUpdateMock,
    delete: dbDeleteMock,
  },
}));

// Mock logger
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

// Mock Redis
const redisPipelineMock = {
  del: vi.fn().mockReturnThis(),
  exec: vi.fn(),
};
const redisMock = {
  status: "ready",
  pipeline: vi.fn(() => redisPipelineMock),
};
const getRedisClientMock = vi.fn(() => redisMock);
vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

// Mock scanPattern
const scanPatternMock = vi.fn();
vi.mock("@/lib/redis/scan-helper", () => ({
  scanPattern: scanPatternMock,
}));

describe("resetUserLimitsOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.status = "ready";
    redisPipelineMock.exec.mockResolvedValue([]);
    dbUpdateWhereMock.mockResolvedValue(undefined);
    resetUserCostResetAtMock.mockResolvedValue(true);
  });

  test("should return PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  test("should return PERMISSION_DENIED when no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  test("should return NOT_FOUND for non-existent user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue(null);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(999);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(resetUserCostResetAtMock).not.toHaveBeenCalled();
  });

  test("should set costResetAt and clear Redis cost cache", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([
      { id: 1, key: "sk-hash-1" },
      { id: 2, key: "sk-hash-2" },
    ]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily", "user:123:cost_weekly"]);
    redisPipelineMock.exec.mockResolvedValue([]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    // costResetAt set via repository function
    expect(resetUserCostResetAtMock).toHaveBeenCalledWith(123, expect.any(Date));
    // Redis cost keys scanned and deleted
    expect(scanPatternMock).toHaveBeenCalled();
    expect(redisMock.pipeline).toHaveBeenCalled();
    expect(redisPipelineMock.del).toHaveBeenCalled();
    expect(redisPipelineMock.exec).toHaveBeenCalled();
    // Revalidate path
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
    // No DB deletes (messageRequest/usageLedger must NOT be deleted)
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  test("should NOT delete messageRequest or usageLedger rows", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    scanPatternMock.mockResolvedValue([]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    await resetUserLimitsOnly(123);

    // Core assertion: db.delete must never be called
    expect(dbDeleteMock).not.toHaveBeenCalled();
    expect(dbDeleteWhereMock).not.toHaveBeenCalled();
  });

  test("should succeed when Redis is not ready", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    redisMock.status = "connecting";

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    // costResetAt still set via repo function
    expect(resetUserCostResetAtMock).toHaveBeenCalledWith(123, expect.any(Date));
    // Redis pipeline NOT called
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  test("should succeed with warning when Redis has partial failures", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily"]);
    redisPipelineMock.exec.mockResolvedValue([
      [null, 1],
      [new Error("Connection reset"), null],
    ]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Some Redis deletes failed during cost cache cleanup",
      expect.objectContaining({ errorCount: 1, userId: 123 })
    );
  });

  test("should succeed when pipeline.exec throws (caught inside clearUserCostCache)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily"]);
    redisPipelineMock.exec.mockRejectedValue(new Error("Pipeline failed"));

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    // pipeline.exec throw is now caught inside clearUserCostCache (never-throws contract)
    // so resetUserLimitsOnly still succeeds without hitting its own catch block
    expect(result.ok).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Redis pipeline.exec() failed during cost cache cleanup",
      expect.objectContaining({ userId: 123 })
    );
  });

  test("should return OPERATION_FAILED on unexpected error", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockRejectedValue(new Error("Database connection failed"));

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  test("should handle user with no keys", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([]);
    scanPatternMock.mockResolvedValue([]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(resetUserCostResetAtMock).toHaveBeenCalledWith(123, expect.any(Date));
    // No DB deletes
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });
});
