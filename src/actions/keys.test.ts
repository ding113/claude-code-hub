import { describe, it, expect, vi, beforeEach } from "vitest";
import { addKey, editKey, removeKey, getKeys, getKeysWithStatistics, getKeyLimitUsage } from "./keys";
import type { User } from "@/types/user";
import type { Key } from "@/types/key";
import type { KeyStatistics } from "@/repository/key";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Mock crypto
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => ({
      toString: (encoding: string) => "a".repeat(size * 2),
    })),
  };
});

// Mock validation schemas
vi.mock("@/lib/validation/schemas", () => ({
  KeyFormSchema: {
    parse: vi.fn((data) => {
      // Simulate schema defaults: only name and expiresAt are passed to parse in addKey
      // The schema would apply defaults for missing optional fields
      return {
        name: data.name,
        expiresAt: data.expiresAt === "" ? undefined : data.expiresAt,
        canLoginWebUi: data.canLoginWebUi ?? true, // default: true
        limit5hUsd: data.limit5hUsd,
        limitWeeklyUsd: data.limitWeeklyUsd,
        limitMonthlyUsd: data.limitMonthlyUsd,
        limitConcurrentSessions: data.limitConcurrentSessions ?? 0, // default: 0
      };
    }),
  },
}));

// Mock key repository
vi.mock("@/repository/key", () => ({
  createKey: vi.fn(),
  updateKey: vi.fn(),
  deleteKey: vi.fn(),
  findActiveKeyByUserIdAndName: vi.fn(),
  findKeyById: vi.fn(),
  countActiveKeysByUser: vi.fn(),
  findKeysWithStatistics: vi.fn(),
  findKeyList: vi.fn(),
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { KeyFormSchema } from "@/lib/validation/schemas";
import {
  createKey,
  updateKey,
  deleteKey,
  findActiveKeyByUserIdAndName,
  findKeyById,
  countActiveKeysByUser,
  findKeysWithStatistics,
  findKeyList,
} from "@/repository/key";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

describe("Keys Server Actions", () => {
  const mockAdminUser: User = {
    id: 1,
    name: "admin",
    description: "Admin User",
    role: "admin",
    rpmLimit: 100,
    dailyLimitUsd: 100,
    providerGroup: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockRegularUser: User = {
    id: 2,
    name: "user",
    description: "Regular User",
    role: "user",
    rpmLimit: 60,
    dailyLimitUsd: 50,
    providerGroup: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockKey: Key = {
    id: 1,
    userId: 2,
    name: "Test Key",
    key: "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    isEnabled: true,
    expiresAt: null,
    canLoginWebUi: true,
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addKey", () => {
    it("should create a key successfully for own user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);
        expect(result.data.name).toBe("Test Key");
      }
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 2,
          name: "Test Key",
          key: "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          is_enabled: true,
          expires_at: null,
        })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    });

    it("should allow admin to create key for any user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(true);
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 2,
        })
      );
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
      expect(createKey).not.toHaveBeenCalled();
    });

    it("should reject when regular user tries to create key for another user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });

      const result = await addKey({
        userId: 999,
        name: "Test Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
      expect(createKey).not.toHaveBeenCalled();
    });

    it("should reject when key with same name already exists", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("已存在且正在生效中");
      }
      expect(createKey).not.toHaveBeenCalled();
    });

    it("should create key with expiration date", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const expiresAt = "2025-12-31T23:59:59.999Z";
      const result = await addKey({
        userId: 2,
        name: "Test Key",
        expiresAt,
      });

      expect(result.ok).toBe(true);
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          expires_at: new Date(expiresAt),
        })
      );
    });

    it("should create key with default rate limit configurations", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(true);
      // Schema provides defaults for optional fields
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 2,
          name: "Test Key",
          can_login_web_ui: true, // default from schema
          limit_concurrent_sessions: 0, // default from schema
        })
      );
    });

    it("should generate unique key with sk- prefix", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(true);
      expect(randomBytes).toHaveBeenCalledWith(16);
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^sk-/),
        })
      );
    });

    it("should handle validation errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(KeyFormSchema.parse).mockImplementation(() => {
        throw new Error("密钥名称不能为空");
      });

      const result = await addKey({
        userId: 2,
        name: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("密钥名称不能为空");
      }
      expect(createKey).not.toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockRejectedValue(new Error("Database connection error"));

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Database connection error");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("editKey", () => {
    it("should update key successfully for own key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue({ ...mockKey, name: "Updated Key" });

      const result = await editKey(1, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: "Updated Key",
        })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    });

    it("should allow admin to update any key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue(mockKey);

      const result = await editKey(1, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalled();
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await editKey(1, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
      expect(updateKey).not.toHaveBeenCalled();
    });

    it("should reject when key does not exist", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(null);

      const result = await editKey(999, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("密钥不存在");
      }
      expect(updateKey).not.toHaveBeenCalled();
    });

    it("should reject when regular user tries to update another user's key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { ...mockRegularUser, id: 999 },
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);

      const result = await editKey(1, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
      expect(updateKey).not.toHaveBeenCalled();
    });

    it("should update key with expiration date", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue(mockKey);

      const expiresAt = "2026-01-01T00:00:00.000Z";
      const result = await editKey(1, {
        name: "Test Key",
        expiresAt,
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          expires_at: new Date(expiresAt),
        })
      );
    });

    it("should clear expiration date when expiresAt is undefined", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue(mockKey);

      const result = await editKey(1, {
        name: "Test Key",
        expiresAt: undefined,
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          expires_at: null,
        })
      );
    });

    it("should update rate limit configurations", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue(mockKey);

      const result = await editKey(1, {
        name: "Test Key",
        limit5hUsd: 20,
        limitWeeklyUsd: 100,
        limitMonthlyUsd: 400,
        limitConcurrentSessions: 10,
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          limit_5h_usd: 20,
          limit_weekly_usd: 100,
          limit_monthly_usd: 400,
          limit_concurrent_sessions: 10,
        })
      );
    });

    it("should update canLoginWebUi flag", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockResolvedValue(mockKey);

      const result = await editKey(1, {
        name: "Test Key",
        canLoginWebUi: false,
      });

      expect(result.ok).toBe(true);
      expect(updateKey).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          can_login_web_ui: false,
        })
      );
    });

    it("should handle validation errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(KeyFormSchema.parse).mockImplementation(() => {
        throw new Error("密钥名称不能为空");
      });

      const result = await editKey(1, {
        name: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("密钥名称不能为空");
      }
      expect(updateKey).not.toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(updateKey).mockRejectedValue(new Error("Database update error"));

      const result = await editKey(1, {
        name: "Updated Key",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Database update error");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("removeKey", () => {
    it("should delete key successfully for own key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(countActiveKeysByUser).mockResolvedValue(2);
      vi.mocked(deleteKey).mockResolvedValue(true);

      const result = await removeKey(1);

      expect(result.ok).toBe(true);
      expect(deleteKey).toHaveBeenCalledWith(1);
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    });

    it("should allow admin to delete any key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(countActiveKeysByUser).mockResolvedValue(2);
      vi.mocked(deleteKey).mockResolvedValue(true);

      const result = await removeKey(1);

      expect(result.ok).toBe(true);
      expect(deleteKey).toHaveBeenCalled();
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await removeKey(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
      expect(deleteKey).not.toHaveBeenCalled();
    });

    it("should reject when key does not exist", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(null);

      const result = await removeKey(999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("密钥不存在");
      }
      expect(deleteKey).not.toHaveBeenCalled();
    });

    it("should reject when regular user tries to delete another user's key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { ...mockRegularUser, id: 999 },
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);

      const result = await removeKey(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
      expect(deleteKey).not.toHaveBeenCalled();
    });

    it("should reject when trying to delete the last key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(countActiveKeysByUser).mockResolvedValue(1);

      const result = await removeKey(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("至少需要保留一个可用的密钥");
      }
      expect(deleteKey).not.toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);
      vi.mocked(countActiveKeysByUser).mockResolvedValue(2);
      vi.mocked(deleteKey).mockRejectedValue(new Error("Database delete error"));

      const result = await removeKey(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Database delete error");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getKeys", () => {
    it("should return keys for own user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyList).mockResolvedValue([mockKey]);

      const result = await getKeys(2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([mockKey]);
      }
      expect(findKeyList).toHaveBeenCalledWith(2);
    });

    it("should allow admin to get keys for any user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyList).mockResolvedValue([mockKey]);

      const result = await getKeys(2);

      expect(result.ok).toBe(true);
      expect(findKeyList).toHaveBeenCalledWith(2);
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getKeys(2);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
      expect(findKeyList).not.toHaveBeenCalled();
    });

    it("should reject when regular user tries to get another user's keys", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });

      const result = await getKeys(999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
      expect(findKeyList).not.toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyList).mockRejectedValue(new Error("Database error"));

      const result = await getKeys(2);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("获取密钥列表失败");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getKeysWithStatistics", () => {
    const mockStats: KeyStatistics[] = [
      {
        ...mockKey,
        totalMessages: 100,
        totalCost: 5.5,
        totalInputTokens: 10000,
        totalOutputTokens: 5000,
      },
    ];

    it("should return statistics for own user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeysWithStatistics).mockResolvedValue(mockStats);

      const result = await getKeysWithStatistics(2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(mockStats);
      }
      expect(findKeysWithStatistics).toHaveBeenCalledWith(2);
    });

    it("should allow admin to get statistics for any user", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeysWithStatistics).mockResolvedValue(mockStats);

      const result = await getKeysWithStatistics(2);

      expect(result.ok).toBe(true);
      expect(findKeysWithStatistics).toHaveBeenCalledWith(2);
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getKeysWithStatistics(2);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
      expect(findKeysWithStatistics).not.toHaveBeenCalled();
    });

    it("should reject when regular user tries to get another user's statistics", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });

      const result = await getKeysWithStatistics(999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
      expect(findKeysWithStatistics).not.toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeysWithStatistics).mockRejectedValue(new Error("Database error"));

      const result = await getKeysWithStatistics(2);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("获取密钥统计失败");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getKeyLimitUsage", () => {
    beforeEach(() => {
      // Mock dynamic imports
      vi.doMock("@/lib/rate-limit", () => ({
        RateLimitService: {
          getCurrentCost: vi.fn((id: number, type: string, period: string) => {
            if (period === "5h") return Promise.resolve(1.5);
            if (period === "weekly") return Promise.resolve(10.25);
            if (period === "monthly") return Promise.resolve(45.75);
            return Promise.resolve(0);
          }),
        },
      }));

      vi.doMock("@/lib/session-tracker", () => ({
        SessionTracker: {
          getKeySessionCount: vi.fn(() => Promise.resolve(3)),
        },
      }));

      vi.doMock("@/lib/rate-limit/time-utils", () => ({
        getResetInfo: vi.fn((period: string) => {
          if (period === "5h") return { resetAt: undefined };
          if (period === "weekly") return { resetAt: new Date("2025-12-01T00:00:00Z") };
          if (period === "monthly") return { resetAt: new Date("2026-01-01T00:00:00Z") };
          return { resetAt: undefined };
        }),
      }));
    });

    it("should return limit usage for own key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue({
        ...mockKey,
        limit5hUsd: 10,
        limitWeeklyUsd: 50,
        limitMonthlyUsd: 200,
        limitConcurrentSessions: 5,
      });

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cost5h.current).toBe(1.5);
        expect(result.data.cost5h.limit).toBe(10);
        expect(result.data.costWeekly.current).toBe(10.25);
        expect(result.data.costWeekly.limit).toBe(50);
        expect(result.data.costMonthly.current).toBe(45.75);
        expect(result.data.costMonthly.limit).toBe(200);
        expect(result.data.concurrentSessions.current).toBe(3);
        expect(result.data.concurrentSessions.limit).toBe(5);
      }
    });

    it("should allow admin to get limit usage for any key", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockAdminUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(true);
    });

    it("should reject when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("未登录");
      }
    });

    it("should reject when key does not exist", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(null);

      const result = await getKeyLimitUsage(999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("密钥不存在");
      }
    });

    it("should reject when regular user tries to get another user's key usage", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { ...mockRegularUser, id: 999 },
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("无权限执行此操作");
      }
    });

    it("should handle keys with null limits", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockResolvedValue(mockKey);

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cost5h.limit).toBeNull();
        expect(result.data.costWeekly.limit).toBeNull();
        expect(result.data.costMonthly.limit).toBeNull();
      }
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findKeyById).mockRejectedValue(new Error("Database error"));

      const result = await getKeyLimitUsage(1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("获取限额使用情况失败");
      }
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("API key generation", () => {
    it("should generate keys with correct format", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);
      }
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^sk-[a-f0-9]{32}$/),
        })
      );
    });

    it("should generate different keys for multiple requests", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);

      const key1Mock = { ...mockKey, key: "sk-key1111111111111111111111111111111" };
      const key2Mock = { ...mockKey, key: "sk-key2222222222222222222222222222222" };

      vi.mocked(createKey)
        .mockResolvedValueOnce(key1Mock)
        .mockResolvedValueOnce(key2Mock);

      const [result1, result2] = await Promise.all([
        addKey({ userId: 2, name: "Key 1" }),
        addKey({ userId: 2, name: "Key 2" }),
      ]);

      expect(result1.ok && result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.data.generatedKey).not.toBe(result2.data.generatedKey);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle concurrent key creation with same name", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockRejectedValueOnce(new Error("UNIQUE constraint failed"));

      const result = await addKey({
        userId: 2,
        name: "Duplicate Key",
      });

      expect(result.ok).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle null and undefined rate limits correctly", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
        limit5hUsd: null,
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
      });

      expect(result.ok).toBe(true);
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          limit_5h_usd: null,
          limit_weekly_usd: null,
          limit_monthly_usd: null,
        })
      );
    });

    it("should handle very large limit values", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: mockRegularUser,
        expires: "2025-12-31",
      });
      vi.mocked(findActiveKeyByUserIdAndName).mockResolvedValue(null);
      vi.mocked(createKey).mockResolvedValue(mockKey);

      const result = await addKey({
        userId: 2,
        name: "Test Key",
        limitMonthlyUsd: 199999.99,
      });

      expect(result.ok).toBe(true);
      expect(createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          limit_monthly_usd: 199999.99,
        })
      );
    });
  });
});
