import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toKey,
  toMessageRequest,
  toModelPrice,
  toProvider,
  toSystemSettings,
  toUser,
} from "./transformers";

describe("src/repository/_shared/transformers.ts", () => {
  const now = new Date("2024-01-02T03:04:05.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("toUser()", () => {
    const baseDbUser = {
      id: 1,
      name: "test-user",
      description: "",
      role: "user",
      providerGroup: null,
      tags: [],
      limitTotalUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    };

    describe("rpm 字段处理", () => {
      /**
       * 注意：rpm <= 0 表示"无限制"，在 toUser() 中统一归一化为 null
       */
      it.each([
        { title: "dbUser.rpm = null -> null", rpm: null, expected: null },
        { title: "dbUser.rpm = undefined -> null", rpm: undefined, expected: null },
        { title: "dbUser.rpm = 0 -> null（0 表示无限制）", rpm: 0, expected: null },
        { title: "dbUser.rpm = 60 -> 60", rpm: 60, expected: 60 },
      ])("$title", ({ rpm, expected }) => {
        const result = toUser({ ...baseDbUser, rpm });
        expect(result.rpm).toBe(expected);
      });
    });

    describe("dailyQuota 字段处理", () => {
      /**
       * 注意：这里显式记录当前行为
       * - `dailyQuota <= 0`（含字符串 "0" / "0.00"）表示“无限制”，在 `toUser()` 中统一归一化为 `null`。
       */
      it.each([
        { title: "dbUser.dailyQuota = null -> null", dailyQuota: null, expected: null },
        { title: "dbUser.dailyQuota = undefined -> null", dailyQuota: undefined, expected: null },
        { title: 'dbUser.dailyQuota = "0" -> null', dailyQuota: "0", expected: null },
        { title: 'dbUser.dailyQuota = "0.00" -> null', dailyQuota: "0.00", expected: null },
        { title: 'dbUser.dailyQuota = "100.00" -> 100', dailyQuota: "100.00", expected: 100 },
        { title: 'dbUser.dailyQuota = "0.01" -> 0.01', dailyQuota: "0.01", expected: 0.01 },
      ])("$title", ({ dailyQuota, expected }) => {
        const result = toUser({ ...baseDbUser, dailyQuota });
        expect(result.dailyQuota).toBe(expected);
      });
    });

    it("createdAt/updatedAt 缺失时默认使用当前时间", () => {
      const result = toUser({
        ...baseDbUser,
        createdAt: undefined,
        updatedAt: undefined,
      });

      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });

  describe("toKey()", () => {
    it("按约定设置默认值与数值转换", () => {
      const result = toKey({
        id: 1,
        userId: 1,
        name: "k1",
        key: "sk-test",
        isEnabled: undefined,
        canLoginWebUi: undefined,
        limit5hUsd: "12.34",
        limitDailyUsd: null,
        dailyResetTime: undefined,
        limitWeeklyUsd: "0",
        limitMonthlyUsd: undefined,
        limitTotalUsd: "0",
        limitConcurrentSessions: undefined,
        providerGroup: undefined,
        cacheTtlPreference: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      });

      expect(result.isEnabled).toBe(true);
      expect(result.canLoginWebUi).toBe(true);
      expect(result.limit5hUsd).toBe(12.34);
      expect(result.limitDailyUsd).toBeNull();
      expect(result.dailyResetTime).toBe("00:00");
      expect(result.limitWeeklyUsd).toBe(0);
      expect(result.limitMonthlyUsd).toBeNull();
      expect(result.limitTotalUsd).toBe(0);
      expect(result.limitConcurrentSessions).toBe(0);
      expect(result.providerGroup).toBeNull();
      expect(result.cacheTtlPreference).toBeNull();
      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });

  describe("toProvider()", () => {
    it("按约定设置默认值与数值转换", () => {
      const result = toProvider({
        id: 1,
        name: "p1",
        url: "https://example.com",
        key: "k1",
        isEnabled: undefined,
        weight: undefined,
        priority: undefined,
        costMultiplier: "1.25",
        preserveClientIp: undefined,
        maxRetryAttempts: "3",
        createdAt: undefined,
        updatedAt: undefined,
      });

      expect(result.isEnabled).toBe(true);
      expect(result.weight).toBe(1);
      expect(result.priority).toBe(0);
      expect(result.costMultiplier).toBe(1.25);
      expect(result.providerType).toBe("claude");
      expect(result.preserveClientIp).toBe(false);
      expect(result.groupTag).toBeNull();
      expect(result.maxRetryAttempts).toBe(3);
      expect(result.circuitBreakerFailureThreshold).toBe(5);
      expect(result.circuitBreakerOpenDuration).toBe(1800000);
      expect(result.firstByteTimeoutStreamingMs).toBe(30000);
      expect(result.streamingIdleTimeoutMs).toBe(10000);
      expect(result.requestTimeoutNonStreamingMs).toBe(600000);
      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });

  describe("toMessageRequest()", () => {
    it("costUsd 归一化为存储字符串（缺失/无效则为 undefined）", () => {
      const withCost = toMessageRequest({
        id: 1,
        costUsd: "1",
        createdAt: undefined,
        updatedAt: undefined,
      });
      expect(withCost.costUsd).toBe("1.000000000000000");

      const withoutCost = toMessageRequest({
        id: 2,
        costUsd: null,
        createdAt: undefined,
        updatedAt: undefined,
      });
      expect(withoutCost.costUsd).toBeUndefined();

      const emptyCost = toMessageRequest({
        id: 3,
        costUsd: "",
        createdAt: undefined,
        updatedAt: undefined,
      });
      expect(emptyCost.costUsd).toBeUndefined();
    });

    it("对可选字段进行 null/undefined 归一化", () => {
      const result = toMessageRequest({
        id: 1,
        costMultiplier: "1.5",
        requestSequence: null,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: undefined,
        cacheTtlApplied: undefined,
        context1mApplied: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      });

      expect(result.costMultiplier).toBe(1.5);
      expect(result.requestSequence).toBeUndefined();
      expect(result.cacheCreation5mInputTokens).toBe(0);
      expect(result.cacheCreation1hInputTokens).toBeUndefined();
      expect(result.cacheTtlApplied).toBeNull();
      expect(result.context1mApplied).toBe(false);
      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });

  describe("toModelPrice()", () => {
    it("createdAt/updatedAt 缺失时默认使用当前时间", () => {
      const result = toModelPrice({ id: 1, createdAt: undefined, updatedAt: undefined });
      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });

  describe("toSystemSettings()", () => {
    it("dbSettings 缺失时返回默认值", () => {
      const result = toSystemSettings(undefined);
      expect(result.id).toBe(0);
      expect(result.siteTitle).toBe("Claude Code Hub");
      expect(result.allowGlobalUsageView).toBe(true);
      expect(result.currencyDisplay).toBe("USD");
      expect(result.billingModelSource).toBe("original");
      expect(result.enableAutoCleanup).toBe(false);
      expect(result.cleanupRetentionDays).toBe(30);
      expect(result.cleanupSchedule).toBe("0 2 * * *");
      expect(result.cleanupBatchSize).toBe(10000);
      expect(result.enableClientVersionCheck).toBe(false);
      expect(result.verboseProviderError).toBe(false);
      expect(result.enableHttp2).toBe(false);
      expect(result.createdAt).toEqual(now);
      expect(result.updatedAt).toEqual(now);
    });
  });
});
