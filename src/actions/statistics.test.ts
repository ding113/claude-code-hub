import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { getUserStatistics } from "./statistics";
import * as authModule from "@/lib/auth";
import * as statisticsRepo from "@/repository/statistics";
import * as systemConfigRepo from "@/repository/system-config";
import type {
  DatabaseStatRow,
  DatabaseUser,
  DatabaseKeyStatRow,
  DatabaseKey,
  TimeRange,
} from "@/types/statistics";

// Mock dependencies
vi.mock("@/lib/auth");
vi.mock("@/repository/statistics");
vi.mock("@/repository/system-config");
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("getUserStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default system settings mock
    vi.mocked(systemConfigRepo.getSystemSettings).mockResolvedValue({
      allowGlobalUsageView: false,
      enableRateLimit: true,
      rateLimitEnabled: true,
    } as Awaited<ReturnType<typeof systemConfigRepo.getSystemSettings>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should return error when user is not logged in", async () => {
      vi.mocked(authModule.getSession).mockResolvedValue(null);

      const result = await getUserStatistics();

      expect(result).toEqual({
        ok: false,
        error: "未登录",
      });
    });

    it("should allow authenticated users to access statistics", async () => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "user" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(statisticsRepo.getKeyStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue([]);

      const result = await getUserStatistics();

      expect(result.ok).toBe(true);
    });
  });

  describe("Time Range Configuration", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue([]);
    });

    it("should use default time range (today) when not specified", async () => {
      await getUserStatistics();

      expect(statisticsRepo.getUserStatisticsFromDB).toHaveBeenCalledWith("today");
    });

    it("should accept valid time ranges (today, 7days, 30days)", async () => {
      const ranges: TimeRange[] = ["today", "7days", "30days"];

      for (const range of ranges) {
        vi.clearAllMocks();
        const result = await getUserStatistics(range);

        expect(result.ok).toBe(true);
        expect(statisticsRepo.getUserStatisticsFromDB).toHaveBeenCalledWith(range);
      }
    });

    it("should reject invalid time ranges", async () => {
      const result = await getUserStatistics("invalid" as TimeRange);

      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("Invalid time range"),
      });
    });

    it("should return correct resolution for time ranges", async () => {
      const testCases: Array<{ range: TimeRange; resolution: "hour" | "day" }> = [
        { range: "today", resolution: "hour" },
        { range: "7days", resolution: "day" },
        { range: "30days", resolution: "day" },
      ];

      for (const { range, resolution } of testCases) {
        const result = await getUserStatistics(range);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.resolution).toBe(resolution);
          expect(result.data.timeRange).toBe(range);
        }
      }
    });
  });

  describe("Admin Mode - User Statistics", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 999, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);
    });

    it("should display all users for admin", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 2,
          user_name: "User2",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 5,
          total_cost: "0.75",
        },
      ];

      const mockUsers: DatabaseUser[] = [
        { id: 1, name: "User1" },
        { id: 2, name: "User2" },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("today");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe("users");
        expect(result.data.users).toHaveLength(2);
        expect(result.data.users[0]).toMatchObject({
          id: 1,
          name: "User1",
          dataKey: "user-1",
        });
      }
    });

    it("should aggregate costs correctly for multiple time periods", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 10,
          total_cost: "1.500000000000000",
        },
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T01:00:00.000Z",
          api_calls: 5,
          total_cost: "0.750000000000000",
        },
      ];

      const mockUsers: DatabaseUser[] = [{ id: 1, name: "User1" }];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("today");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData).toHaveLength(2);
        expect(result.data.chartData[0]).toMatchObject({
          date: "2025-01-01T00:00:00.000Z",
          "user-1_cost": "1.500000000000000",
          "user-1_calls": 10,
        });
        expect(result.data.chartData[1]).toMatchObject({
          date: "2025-01-01T01:00:00.000Z",
          "user-1_cost": "0.750000000000000",
          "user-1_calls": 5,
        });
      }
    });

    it("should handle users with no API calls (zero cost)", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "ActiveUser",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 2,
          user_name: "InactiveUser",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 0,
          total_cost: 0,
        },
      ];

      const mockUsers: DatabaseUser[] = [
        { id: 1, name: "ActiveUser" },
        { id: 2, name: "InactiveUser" },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("today");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData[0]).toHaveProperty("user-2_cost", "0.000000000000000");
        expect(result.data.chartData[0]).toHaveProperty("user-2_calls", 0);
      }
    });
  });

  describe("Non-Admin Mode - Key Statistics Only", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "user" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(systemConfigRepo.getSystemSettings).mockResolvedValue({
        allowGlobalUsageView: false,
        enableRateLimit: true,
        rateLimitEnabled: true,
      } as Awaited<ReturnType<typeof systemConfigRepo.getSystemSettings>>);
    });

    it("should display only own keys when allowGlobalUsageView=false", async () => {
      const mockKeyStats: DatabaseKeyStatRow[] = [
        {
          key_id: 10,
          key_name: "MyKey1",
          date: "2025-01-01",
          api_calls: 5,
          total_cost: "0.5",
        },
      ];

      const mockKeys: DatabaseKey[] = [{ id: 10, name: "MyKey1" }];

      vi.mocked(statisticsRepo.getKeyStatisticsFromDB).mockResolvedValue(mockKeyStats);
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue(mockKeys);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe("keys");
        expect(result.data.users).toHaveLength(1);
        expect(result.data.users[0]).toMatchObject({
          id: 10,
          name: "MyKey1",
          dataKey: "key-10",
        });
        expect(statisticsRepo.getKeyStatisticsFromDB).toHaveBeenCalledWith(1, "7days");
        expect(statisticsRepo.getActiveKeysForUserFromDB).toHaveBeenCalledWith(1);
      }
    });

    it("should format chart data correctly for key statistics", async () => {
      const mockKeyStats: DatabaseKeyStatRow[] = [
        {
          key_id: 10,
          key_name: "TestKey",
          date: "2025-01-01",
          api_calls: 100,
          total_cost: "5.123456789012345",
        },
      ];

      const mockKeys: DatabaseKey[] = [{ id: 10, name: "TestKey" }];

      vi.mocked(statisticsRepo.getKeyStatisticsFromDB).mockResolvedValue(mockKeyStats);
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue(mockKeys);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData).toHaveLength(1);
        expect(result.data.chartData[0]).toMatchObject({
          date: "2025-01-01",
          "key-10_cost": "5.123456789012345",
          "key-10_calls": 100,
        });
      }
    });
  });

  describe("Mixed Mode - Own Keys + Others Aggregate", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "user" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(systemConfigRepo.getSystemSettings).mockResolvedValue({
        allowGlobalUsageView: true,
        enableRateLimit: true,
        rateLimitEnabled: true,
      } as Awaited<ReturnType<typeof systemConfigRepo.getSystemSettings>>);
    });

    it("should display own keys + other users aggregate when allowGlobalUsageView=true", async () => {
      const mockOwnKeys: DatabaseKeyStatRow[] = [
        {
          key_id: 10,
          key_name: "MyKey1",
          date: "2025-01-01",
          api_calls: 5,
          total_cost: "0.5",
        },
      ];

      const mockOthersAggregate: DatabaseStatRow[] = [
        {
          user_id: -1,
          user_name: "其他用户",
          date: "2025-01-01",
          api_calls: 20,
          total_cost: "2.5",
        },
      ];

      const mockKeys: DatabaseKey[] = [{ id: 10, name: "MyKey1" }];

      vi.mocked(statisticsRepo.getMixedStatisticsFromDB).mockResolvedValue({
        ownKeys: mockOwnKeys,
        othersAggregate: mockOthersAggregate,
      });
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue(mockKeys);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe("mixed");
        expect(result.data.users).toHaveLength(2);
        expect(result.data.users[0]).toMatchObject({
          id: 10,
          name: "MyKey1",
          dataKey: "key-10",
        });
        expect(result.data.users[1]).toMatchObject({
          id: -1,
          name: "其他用户",
          dataKey: "key--1",
        });
        expect(result.data.chartData).toHaveLength(1);
        expect(result.data.chartData[0]).toMatchObject({
          date: "2025-01-01",
          "key-10_cost": "0.500000000000000",
          "key-10_calls": 5,
          "key--1_cost": "2.500000000000000",
          "key--1_calls": 20,
        });
      }
    });

    it("should handle empty own keys with only other users data", async () => {
      const mockOthersAggregate: DatabaseStatRow[] = [
        {
          user_id: -1,
          user_name: "其他用户",
          date: "2025-01-01",
          api_calls: 50,
          total_cost: "10.0",
        },
      ];

      vi.mocked(statisticsRepo.getMixedStatisticsFromDB).mockResolvedValue({
        ownKeys: [],
        othersAggregate: mockOthersAggregate,
      });
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue([]);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe("mixed");
        expect(result.data.users).toHaveLength(1);
        expect(result.data.users[0].name).toBe("其他用户");
        expect(result.data.chartData[0]).toHaveProperty("key--1_cost");
        expect(result.data.chartData[0]).toHaveProperty("key--1_calls", 50);
      }
    });
  });

  describe("Date Formatting and Timezone Handling", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue([
        { id: 1, name: "User1" },
      ]);
    });

    it("should format hourly data correctly (today)", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T08:00:00.000Z",
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T09:00:00.000Z",
          api_calls: 5,
          total_cost: "0.75",
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("today");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resolution).toBe("hour");
        expect(result.data.chartData).toHaveLength(2);
        expect(result.data.chartData[0].date).toBe("2025-01-01T08:00:00.000Z");
        expect(result.data.chartData[1].date).toBe("2025-01-01T09:00:00.000Z");
      }
    });

    it("should format daily data correctly (7days, 30days)", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T00:00:00.000Z",
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-02T00:00:00.000Z",
          api_calls: 5,
          total_cost: "0.75",
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resolution).toBe("day");
        expect(result.data.chartData).toHaveLength(2);
        expect(result.data.chartData[0].date).toBe("2025-01-01");
        expect(result.data.chartData[1].date).toBe("2025-01-02");
      }
    });

    it("should handle timezone boundaries correctly (Asia/Shanghai)", async () => {
      // Simulating timezone boundary: different dates in UTC but same date in CST
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01T00:00:00.000Z", // 08:00 CST (same day)
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-02T00:00:00.000Z", // 08:00 CST (next day)
          api_calls: 5,
          total_cost: "0.75",
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Two different dates should produce two chart data entries
        expect(result.data.chartData).toHaveLength(2);
        expect(result.data.chartData[0].date).toBe("2025-01-01");
        expect(result.data.chartData[1].date).toBe("2025-01-02");
      }
    });
  });

  describe("Cost Aggregation and Precision", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue([
        { id: 1, name: "User1" },
      ]);
    });

    it("should handle large cost values (15 decimal precision)", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01",
          api_calls: 1000000,
          total_cost: "123456.789012345678901",
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData[0]["user-1_cost"]).toBe("123456.789012345678901");
      }
    });

    it("should handle null cost values", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01",
          api_calls: 0,
          total_cost: null,
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData[0]["user-1_cost"]).toBe("0.000000000000000");
      }
    });

    it("should handle very small cost values (near-zero)", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01",
          api_calls: 1,
          total_cost: "0.000000000000001",
        },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData[0]["user-1_cost"]).toBe("0.000000000000001");
      }
    });

    it("should aggregate costs for multiple users on same date", async () => {
      const mockUserStats: DatabaseStatRow[] = [
        {
          user_id: 1,
          user_name: "User1",
          date: "2025-01-01",
          api_calls: 10,
          total_cost: "1.5",
        },
        {
          user_id: 2,
          user_name: "User2",
          date: "2025-01-01",
          api_calls: 5,
          total_cost: "0.75",
        },
      ];

      const mockUsers: DatabaseUser[] = [
        { id: 1, name: "User1" },
        { id: 2, name: "User2" },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue(mockUserStats);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData).toHaveLength(1);
        expect(result.data.chartData[0]).toMatchObject({
          date: "2025-01-01",
          "user-1_cost": "1.500000000000000",
          "user-1_calls": 10,
          "user-2_cost": "0.750000000000000",
          "user-2_calls": 5,
        });
      }
    });
  });

  describe("Empty Data Handling", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);
    });

    it("should handle empty statistics data", async () => {
      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue([]);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData).toEqual([]);
        expect(result.data.users).toEqual([]);
      }
    });

    it("should handle empty time period (no data for range)", async () => {
      const mockUsers: DatabaseUser[] = [{ id: 1, name: "User1" }];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("today");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.chartData).toEqual([]);
        expect(result.data.users).toHaveLength(1);
      }
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);
    });

    it("should handle database query errors", async () => {
      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockRejectedValue(
        new Error("Database connection error")
      );

      const result = await getUserStatistics("7days");

      expect(result).toEqual({
        ok: false,
        error: "获取统计数据失败：Database connection error",
      });
    });

    it("should handle numeric field overflow error", async () => {
      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockRejectedValue(
        new Error("numeric field overflow")
      );

      const result = await getUserStatistics("7days");

      expect(result).toEqual({
        ok: false,
        error: "数据金额过大，请检查数据库中的费用记录",
      });
    });

    it("should handle system config fetch errors", async () => {
      vi.mocked(systemConfigRepo.getSystemSettings).mockRejectedValue(
        new Error("Config fetch error")
      );

      const result = await getUserStatistics("7days");

      expect(result).toEqual({
        ok: false,
        error: "获取统计数据失败：Config fetch error",
      });
    });

    it("should handle unknown errors gracefully", async () => {
      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockRejectedValue(
        "Unknown error string"
      );

      const result = await getUserStatistics("7days");

      expect(result).toEqual({
        ok: false,
        error: "获取统计数据失败：未知错误",
      });
    });

    it("should handle repository throwing unexpected errors", async () => {
      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockRejectedValue({
        code: "UNKNOWN_ERROR",
        message: "Unexpected database error",
      });

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("获取统计数据失败：未知错误");
    });
  });

  describe("User Naming Fallback", () => {
    beforeEach(() => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
    });

    it("should use default user name when name is null (users mode)", async () => {
      const mockUsers: DatabaseUser[] = [{ id: 1, name: null } as unknown as DatabaseUser];

      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.users[0].name).toBe("User1");
      }
    });

    it("should use default key name when name is null (keys mode)", async () => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "user" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      vi.mocked(systemConfigRepo.getSystemSettings).mockResolvedValue({
        allowGlobalUsageView: false,
      } as Awaited<ReturnType<typeof systemConfigRepo.getSystemSettings>>);

      const mockKeys: DatabaseKey[] = [{ id: 10, name: null } as unknown as DatabaseKey];

      vi.mocked(statisticsRepo.getKeyStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue(mockKeys);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.users[0].name).toBe("Key10");
      }
    });
  });

  describe("Data Key Generation", () => {
    it("should generate unique data keys to avoid name collisions", async () => {
      vi.mocked(authModule.getSession).mockResolvedValue({
        user: { id: 1, role: "admin" },
      } as Awaited<ReturnType<typeof authModule.getSession>>);

      const mockUsers: DatabaseUser[] = [
        { id: 1, name: "User1" },
        { id: 2, name: "User2" },
        { id: 3, name: "User3" },
      ];

      vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
      vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue(mockUsers);

      const result = await getUserStatistics("7days");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const dataKeys = result.data.users.map((u) => u.dataKey);
        expect(dataKeys).toEqual(["user-1", "user-2", "user-3"]);
        expect(new Set(dataKeys).size).toBe(3); // All unique
      }
    });

    it("should use correct prefix for different modes", async () => {
      const testCases: Array<{
        role: "admin" | "user";
        allowGlobalUsageView: boolean;
        expectedPrefix: string;
      }> = [
        { role: "admin", allowGlobalUsageView: false, expectedPrefix: "user" },
        { role: "user", allowGlobalUsageView: false, expectedPrefix: "key" },
        { role: "user", allowGlobalUsageView: true, expectedPrefix: "key" },
      ];

      for (const { role, allowGlobalUsageView, expectedPrefix } of testCases) {
        vi.clearAllMocks();

        vi.mocked(authModule.getSession).mockResolvedValue({
          user: { id: 1, role },
        } as Awaited<ReturnType<typeof authModule.getSession>>);

        vi.mocked(systemConfigRepo.getSystemSettings).mockResolvedValue({
          allowGlobalUsageView,
        } as Awaited<ReturnType<typeof systemConfigRepo.getSystemSettings>>);

        if (role === "admin") {
          vi.mocked(statisticsRepo.getUserStatisticsFromDB).mockResolvedValue([]);
          vi.mocked(statisticsRepo.getActiveUsersFromDB).mockResolvedValue([
            { id: 1, name: "Test" },
          ]);
        } else if (allowGlobalUsageView) {
          vi.mocked(statisticsRepo.getMixedStatisticsFromDB).mockResolvedValue({
            ownKeys: [],
            othersAggregate: [],
          });
          vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue([
            { id: 10, name: "TestKey" },
          ]);
        } else {
          vi.mocked(statisticsRepo.getKeyStatisticsFromDB).mockResolvedValue([]);
          vi.mocked(statisticsRepo.getActiveKeysForUserFromDB).mockResolvedValue([
            { id: 10, name: "TestKey" },
          ]);
        }

        const result = await getUserStatistics("7days");

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.users[0].dataKey).toContain(expectedPrefix);
        }
      }
    });
  });
});
