/**
 * Lease Service Tests
 *
 * TDD: RED phase - tests for lease generation and refresh mechanism
 * DB is authoritative, Redis stores lease slices.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/config", () => ({
  getEnvConfig: () => ({ TZ: "Asia/Shanghai" }),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/repository/statistics", () => ({
  sumKeyCostInTimeRange: vi.fn(),
  sumUserCostInTimeRange: vi.fn(),
  sumProviderCostInTimeRange: vi.fn(),
  findKeyCostEntriesInTimeRange: vi.fn(),
  findUserCostEntriesInTimeRange: vi.fn(),
  findProviderCostEntriesInTimeRange: vi.fn(),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(),
}));

// Mock Redis client
const mockRedis = {
  status: "ready",
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
  del: vi.fn(),
  pipeline: vi.fn(() => ({
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })),
};

describe("LeaseService", () => {
  const nowMs = 1706400000000; // 2024-01-28 00:00:00 UTC

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCostLease", () => {
    it("should return cached lease from Redis if valid", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { deserializeLease } = await import("@/lib/rate-limit/lease");

      // Setup: cached lease in Redis
      const cachedLease = {
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000, // 5 seconds ago
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 60, // 60 seconds TTL
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result).not.toBeNull();
      expect(result?.remainingBudget).toBe(2.5);
    });

    it("should refresh lease from DB when Redis cache is empty", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      // Setup: no cache
      mockRedis.get.mockResolvedValue(null);

      // Setup: DB returns usage
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(40);

      // Setup: system settings
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result).not.toBeNull();
      expect(result?.currentUsage).toBe(40);
      // remainingBudget = min(100 * 0.05, 100 - 40) = min(5, 60) = 5
      expect(result?.remainingBudget).toBe(5);
      expect(sumKeyCostInTimeRange).toHaveBeenCalled();
    });

    it("should refresh lease when TTL has expired", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      // Setup: expired lease in Redis
      const expiredLease = {
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 120 * 1000, // 2 minutes ago
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 60, // 60 seconds TTL - expired!
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(expiredLease));

      // Setup: DB returns new usage
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(55);

      // Setup: system settings
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result).not.toBeNull();
      expect(result?.currentUsage).toBe(55);
      expect(sumKeyCostInTimeRange).toHaveBeenCalled();
    });

    it("should return null and fail-open when DB query fails", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { logger } = await import("@/lib/logger");

      // Setup: no cache
      mockRedis.get.mockResolvedValue(null);

      // Setup: DB throws error
      vi.mocked(sumKeyCostInTimeRange).mockRejectedValue(new Error("DB connection failed"));

      // Setup: system settings
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      // Fail-open: return null, log error
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("should use correct percent based on window type", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(0);

      // System settings with different percents per window
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1, // 10%
        quotaLeasePercentDaily: 0.05, // 5%
        quotaLeasePercentWeekly: 0.03, // 3%
        quotaLeasePercentMonthly: 0.02, // 2%
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      // Test 5h window
      const result5h = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "5h",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });
      expect(result5h?.remainingBudget).toBe(10); // 100 * 0.1 = 10

      // Test weekly window
      const resultWeekly = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 456,
        window: "weekly",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });
      expect(resultWeekly?.remainingBudget).toBe(3); // 100 * 0.03 = 3
    });

    it("should respect capUsd from system settings", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(0);

      // System settings with capUsd = 3
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: 3, // Cap at $3
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      // limit=1000, percent=0.05 -> 50, but cap=3 -> slice=3
      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 1000,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result?.remainingBudget).toBe(3);
    });

    it("should use system settings refresh interval as TTL", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(0);

      // System settings with 30s refresh interval
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 30, // 30 seconds
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result?.ttlSeconds).toBe(30);
      // Verify setex was called with correct TTL
      expect(mockRedis.setex).toHaveBeenCalledWith(expect.any(String), 30, expect.any(String));
    });

    it("should handle user entity type", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumUserCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumUserCostInTimeRange).mockResolvedValue(25);

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "user",
        entityId: 999,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "rolling",
      });

      expect(result).not.toBeNull();
      expect(result?.entityType).toBe("user");
      expect(result?.currentUsage).toBe(25);
      expect(sumUserCostInTimeRange).toHaveBeenCalled();
    });

    it("should handle provider entity type", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumProviderCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumProviderCostInTimeRange).mockResolvedValue(75);

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "provider",
        entityId: 555,
        window: "monthly",
        limitAmount: 200,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result).not.toBeNull();
      expect(result?.entityType).toBe("provider");
      expect(result?.currentUsage).toBe(75);
      // remainingBudget = min(200 * 0.02, 200 - 75) = min(4, 125) = 4
      expect(result?.remainingBudget).toBe(4);
      expect(sumProviderCostInTimeRange).toHaveBeenCalled();
    });

    it("should return 0 remaining budget when usage exceeds limit", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      mockRedis.get.mockResolvedValue(null);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(105); // Over limit

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result?.remainingBudget).toBe(0);
    });
  });

  describe("refreshCostLeaseFromDb", () => {
    it("should query DB and create new lease", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(30);

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      const result = await LeaseService.refreshCostLeaseFromDb({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      expect(result).not.toBeNull();
      expect(result?.snapshotAtMs).toBe(nowMs);
      expect(result?.currentUsage).toBe(30);
      expect(result?.remainingBudget).toBe(5); // min(100*0.05, 70) = 5
    });

    it("should store lease in Redis with correct TTL", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(0);

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        id: 1,
        siteTitle: "Test",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        verboseProviderError: false,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 15,
        quotaLeasePercent5h: 0.1,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.03,
        quotaLeasePercentMonthly: 0.02,
        quotaLeaseCapUsd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRedis.setex.mockResolvedValue("OK");

      await LeaseService.refreshCostLeaseFromDb({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100,
        resetTime: "00:00",
        resetMode: "fixed",
      });

      const expectedKey = buildLeaseKey("key", 123, "daily");
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expectedKey,
        15, // TTL from system settings
        expect.any(String)
      );
    });
  });

  describe("decrementLeaseBudget", () => {
    it("should decrement lease budget atomically using Lua script", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      // Lua script returns: [newRemaining, success]
      // newRemaining = 2.5, success = 1 (decremented successfully)
      mockRedis.eval.mockResolvedValue([2.5, 1]);

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 0.5,
      });

      expect(result).toEqual({
        success: true,
        newRemaining: 2.5,
      });

      const expectedKey = buildLeaseKey("key", 123, "daily");
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String), // Lua script
        1, // Number of keys
        expectedKey, // KEYS[1]
        0.5 // ARGV[1] = cost
      );
    });

    it("should return success=false when budget is insufficient", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");

      // Lua script returns: [0, 0] = insufficient budget
      mockRedis.eval.mockResolvedValue([0, 0]);

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 10.0,
      });

      expect(result).toEqual({
        success: false,
        newRemaining: 0,
      });
    });

    it("should return success=false when lease key does not exist", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");

      // Lua script returns: [-1, 0] = key not found
      mockRedis.eval.mockResolvedValue([-1, 0]);

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 1.0,
      });

      expect(result).toEqual({
        success: false,
        newRemaining: -1,
      });
    });

    it("should fail-open on Redis error", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { logger } = await import("@/lib/logger");

      mockRedis.eval.mockRejectedValue(new Error("Redis connection failed"));

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 1.0,
      });

      // Fail-open: return success=true to allow request
      expect(result).toEqual({
        success: true,
        newRemaining: -1,
        failOpen: true,
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it("should fail-open when Redis is not ready", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");

      // Simulate Redis not ready
      mockRedis.status = "connecting";

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 1.0,
      });

      // Fail-open: return success=true
      expect(result).toEqual({
        success: true,
        newRemaining: -1,
        failOpen: true,
      });

      // Restore Redis status for other tests
      mockRedis.status = "ready";
    });

    it("should handle different entity types", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      mockRedis.eval.mockResolvedValue([5.0, 1]);

      // Test user entity
      await LeaseService.decrementLeaseBudget({
        entityType: "user",
        entityId: 999,
        window: "weekly",
        cost: 2.0,
      });

      const expectedUserKey = buildLeaseKey("user", 999, "weekly");
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, expectedUserKey, 2.0);

      // Test provider entity
      await LeaseService.decrementLeaseBudget({
        entityType: "provider",
        entityId: 555,
        window: "monthly",
        cost: 3.5,
      });

      const expectedProviderKey = buildLeaseKey("provider", 555, "monthly");
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, expectedProviderKey, 3.5);
    });

    it("should handle zero cost decrement", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");

      mockRedis.eval.mockResolvedValue([5.0, 1]);

      const result = await LeaseService.decrementLeaseBudget({
        entityType: "key",
        entityId: 123,
        window: "daily",
        cost: 0,
      });

      expect(result.success).toBe(true);
      expect(result.newRemaining).toBe(5.0);
    });
  });

  describe("getCostLease - limit change detection", () => {
    const nowMs = 1706400000000;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(nowMs));
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should force refresh when limitAmount increases", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");

      // Setup: cached lease with limitAmount=100
      const cachedLease = {
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000,
        currentUsage: 50,
        limitAmount: 100, // Old limit
        remainingBudget: 2.5,
        ttlSeconds: 60,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      // Mock system settings and DB query for refresh
      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercentDaily: 0.05,
      } as ReturnType<typeof getCachedSystemSettings> extends Promise<infer T> ? T : never);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(50);

      // Call with increased limitAmount=150
      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 150, // New limit (increased)
        resetTime: "00:00",
        resetMode: "fixed",
      });

      // Should have refreshed from DB
      expect(sumKeyCostInTimeRange).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.limitAmount).toBe(150);
    });

    it("should force refresh when limitAmount decreases", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");

      // Setup: cached lease with limitAmount=100
      const cachedLease = {
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000,
        currentUsage: 50,
        limitAmount: 100, // Old limit
        remainingBudget: 2.5,
        ttlSeconds: 60,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercentDaily: 0.05,
      } as ReturnType<typeof getCachedSystemSettings> extends Promise<infer T> ? T : never);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(50);

      // Call with decreased limitAmount=50
      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 50, // New limit (decreased)
        resetTime: "00:00",
        resetMode: "fixed",
      });

      // Should have refreshed from DB
      expect(sumKeyCostInTimeRange).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.limitAmount).toBe(50);
    });

    it("should return cached lease when limitAmount unchanged", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");

      // Setup: cached lease with limitAmount=100
      const cachedLease = {
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000,
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 60,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      // Call with same limitAmount=100
      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        limitAmount: 100, // Same limit
        resetTime: "00:00",
        resetMode: "fixed",
      });

      // Should NOT have refreshed from DB
      expect(sumKeyCostInTimeRange).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.limitAmount).toBe(100);
      expect(result?.remainingBudget).toBe(2.5);
    });

    it("should allow requests after limit increase for over-limit user", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { sumUserCostInTimeRange } = await import("@/repository/statistics");

      // Setup: user is over limit (usage=100, limit=100, remaining=0)
      const cachedLease = {
        entityType: "user",
        entityId: 456,
        window: "daily",
        resetMode: "rolling",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000,
        currentUsage: 100,
        limitAmount: 100, // Old limit
        remainingBudget: 0, // Over limit
        ttlSeconds: 60,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercentDaily: 0.05,
      } as ReturnType<typeof getCachedSystemSettings> extends Promise<infer T> ? T : never);
      vi.mocked(sumUserCostInTimeRange).mockResolvedValue(100); // Current usage still 100

      // Admin increases limit to 150
      const result = await LeaseService.getCostLease({
        entityType: "user",
        entityId: 456,
        window: "daily",
        limitAmount: 150, // Increased limit
        resetTime: "00:00",
        resetMode: "rolling",
      });

      // Should have refreshed and now have remaining budget
      expect(sumUserCostInTimeRange).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.limitAmount).toBe(150);
      // remainingBudget = min(150 * 0.05, 150 - 100) = min(7.5, 50) = 7.5
      expect(result?.remainingBudget).toBeGreaterThan(0);
    });

    it("should block requests after limit decrease below usage", async () => {
      const { LeaseService } = await import("@/lib/rate-limit/lease-service");
      const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
      const { sumKeyCostInTimeRange } = await import("@/repository/statistics");

      // Setup: user has used 80, limit was 100, remaining=1
      const cachedLease = {
        entityType: "key",
        entityId: 789,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 5000,
        currentUsage: 80,
        limitAmount: 100, // Old limit
        remainingBudget: 1, // Still has budget
        ttlSeconds: 60,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedLease));

      vi.mocked(getCachedSystemSettings).mockResolvedValue({
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercentDaily: 0.05,
      } as ReturnType<typeof getCachedSystemSettings> extends Promise<infer T> ? T : never);
      vi.mocked(sumKeyCostInTimeRange).mockResolvedValue(80); // Current usage still 80

      // Admin decreases limit to 50 (below current usage of 80)
      const result = await LeaseService.getCostLease({
        entityType: "key",
        entityId: 789,
        window: "daily",
        limitAmount: 50, // Decreased limit (below usage)
        resetTime: "00:00",
        resetMode: "fixed",
      });

      // Should have refreshed and now have 0 remaining budget
      expect(sumKeyCostInTimeRange).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.limitAmount).toBe(50);
      // remainingBudget = min(50 * 0.05, 50 - 80) = min(2.5, -30) = 0 (clamped)
      expect(result?.remainingBudget).toBe(0);
    });
  });
});
