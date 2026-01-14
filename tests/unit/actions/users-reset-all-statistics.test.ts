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
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
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

// Mock drizzle db
const dbDeleteWhereMock = vi.fn();
const dbDeleteMock = vi.fn(() => ({ where: dbDeleteWhereMock }));
vi.mock("@/drizzle/db", () => ({
  db: {
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

describe("resetUserAllStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset redis mock to ready state
    redisMock.status = "ready";
    redisPipelineMock.exec.mockResolvedValue([]);
    // DB delete returns resolved promise
    dbDeleteWhereMock.mockResolvedValue(undefined);
  });

  test("should return PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  test("should return PERMISSION_DENIED when no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  test("should return NOT_FOUND for non-existent user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue(null);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(999);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  test("should successfully reset all user statistics", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily", "key:2:cost_weekly"]);
    redisPipelineMock.exec.mockResolvedValue([]);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    // DB delete called
    expect(dbDeleteMock).toHaveBeenCalled();
    expect(dbDeleteWhereMock).toHaveBeenCalled();
    // Redis operations
    expect(redisMock.pipeline).toHaveBeenCalled();
    expect(redisPipelineMock.del).toHaveBeenCalled();
    expect(redisPipelineMock.exec).toHaveBeenCalled();
    // Revalidate path
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
    // Logging
    expect(loggerMock.info).toHaveBeenCalled();
  });

  test("should succeed even when Redis is not ready", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1 }]);
    redisMock.status = "connecting";

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    // DB delete still called
    expect(dbDeleteMock).toHaveBeenCalled();
    // Redis pipeline NOT called (status not ready)
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  test("should succeed with warning when Redis has partial failures", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1 }]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily"]);
    // Simulate partial failure - some commands return errors
    redisPipelineMock.exec.mockResolvedValue([
      [null, 1], // success
      [new Error("Connection reset"), null], // failure
    ]);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Some Redis deletes failed during user statistics reset",
      expect.objectContaining({ errorCount: 1, userId: 123 })
    );
  });

  test("should succeed with warning when scanPattern fails", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1 }]);
    // scanPattern fails but is caught by .catch() in Promise.all
    scanPatternMock.mockRejectedValue(new Error("Redis connection lost"));
    redisPipelineMock.exec.mockResolvedValue([]);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    // Should still succeed - error is caught inside Promise.all
    expect(result.ok).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  test("should succeed with error log when pipeline.exec throws", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1 }]);
    scanPatternMock.mockResolvedValue(["key:1:cost_daily"]);
    // pipeline.exec throws - caught by outer try-catch
    redisPipelineMock.exec.mockRejectedValue(new Error("Pipeline failed"));

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    // Should still succeed - DB logs already deleted
    expect(result.ok).toBe(true);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Failed to clear Redis cache during user statistics reset",
      expect.objectContaining({ userId: 123 })
    );
  });

  test("should return OPERATION_FAILED on unexpected error", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockRejectedValue(new Error("Database connection failed"));

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  test("should handle user with no keys", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([]); // No keys
    scanPatternMock.mockResolvedValue([]);
    redisPipelineMock.exec.mockResolvedValue([]);

    const { resetUserAllStatistics } = await import("@/actions/users");
    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(dbDeleteMock).toHaveBeenCalled();
  });
});
