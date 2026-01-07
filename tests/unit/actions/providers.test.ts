import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

const findAllProvidersFreshMock = vi.fn();
const getProviderStatisticsMock = vi.fn();
const createProviderMock = vi.fn();
const updateProviderMock = vi.fn();
const deleteProviderMock = vi.fn();

const publishProviderCacheInvalidationMock = vi.fn();
const saveProviderCircuitConfigMock = vi.fn();
const deleteProviderCircuitConfigMock = vi.fn();
const clearConfigCacheMock = vi.fn();
const clearProviderStateMock = vi.fn();

const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  createProvider: createProviderMock,
  deleteProvider: deleteProviderMock,
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: findAllProvidersFreshMock,
  findProviderById: vi.fn(async () => null),
  getProviderStatistics: getProviderStatisticsMock,
  resetProviderTotalCostResetAt: vi.fn(async () => {}),
  updateProvider: updateProviderMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  deleteProviderCircuitConfig: deleteProviderCircuitConfigMock,
  saveProviderCircuitConfig: saveProviderCircuitConfigMock,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearConfigCache: clearConfigCacheMock,
  clearProviderState: clearProviderStateMock,
  getAllHealthStatusAsync: vi.fn(async () => ({})),
  resetCircuit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`超时：${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

describe("Provider Actions - Async Optimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findAllProvidersFreshMock.mockResolvedValue([
      {
        id: 1,
        name: "p1",
        url: "https://api.example.com",
        key: "sk-test-1234567890",
        isEnabled: true,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        groupTag: "default",
        providerType: "claude",
        preserveClientIp: false,
        modelRedirects: null,
        allowedModels: null,
        joinClaudePool: false,
        codexInstructionsStrategy: "inherit",
        mcpPassthroughType: "none",
        mcpPassthroughUrl: null,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        maxRetryAttempts: null,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerOpenDuration: 1800000,
        circuitBreakerHalfOpenSuccessThreshold: 2,
        proxyUrl: null,
        proxyFallbackToDirect: false,
        firstByteTimeoutStreamingMs: null,
        streamingIdleTimeoutMs: null,
        requestTimeoutNonStreamingMs: null,
        websiteUrl: null,
        faviconUrl: null,
        cacheTtlPreference: "inherit",
        context1mPreference: "inherit",
        codexReasoningEffortPreference: "inherit",
        codexReasoningSummaryPreference: "inherit",
        codexTextVerbosityPreference: "inherit",
        codexParallelToolCallsPreference: "inherit",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    getProviderStatisticsMock.mockResolvedValue([]);

    createProviderMock.mockResolvedValue({
      id: 123,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
    });

    updateProviderMock.mockResolvedValue({
      id: 1,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
    });

    deleteProviderMock.mockResolvedValue(undefined);
    publishProviderCacheInvalidationMock.mockResolvedValue(undefined);
    saveProviderCircuitConfigMock.mockResolvedValue(undefined);
    deleteProviderCircuitConfigMock.mockResolvedValue(undefined);
    clearProviderStateMock.mockResolvedValue(undefined);
  });

  describe("getProviders", () => {
    it("should return providers without blocking on statistics", async () => {
      getProviderStatisticsMock.mockImplementation(() => new Promise(() => {}));

      const { getProviders } = await import("@/actions/providers");
      const result = await withTimeout(getProviders(), 200);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
      expect(getProviderStatisticsMock).not.toHaveBeenCalled();
    });

    it("should complete within 500ms", async () => {
      getProviderStatisticsMock.mockImplementation(() => new Promise(() => {}));

      const { getProviders } = await import("@/actions/providers");
      const start = nowMs();
      const result = await withTimeout(getProviders(), 500);
      const elapsed = nowMs() - start;

      expect(result).toHaveLength(1);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("getProviderStatisticsAsync", () => {
    it("should return statistics map by provider id", async () => {
      getProviderStatisticsMock.mockResolvedValue([
        {
          id: 1,
          today_cost: "1.23",
          today_calls: 10,
          last_call_time: new Date("2026-01-01T00:00:00.000Z"),
          last_call_model: "model-a",
        },
        {
          id: 2,
          today_cost: "0",
          today_calls: 0,
          last_call_time: "2026-01-02T00:00:00.000Z",
          last_call_model: null,
        },
      ]);

      const { getProviderStatisticsAsync } = await import("@/actions/providers");
      const result = await getProviderStatisticsAsync();

      expect(result[1]).toEqual({
        todayCost: "1.23",
        todayCalls: 10,
        lastCallTime: "2026-01-01T00:00:00.000Z",
        lastCallModel: "model-a",
      });
      expect(result[2]).toEqual({
        todayCost: "0",
        todayCalls: 0,
        lastCallTime: "2026-01-02T00:00:00.000Z",
        lastCallModel: null,
      });
    });

    it("should return empty object for non-admin", async () => {
      getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

      const { getProviderStatisticsAsync } = await import("@/actions/providers");
      const result = await getProviderStatisticsAsync();

      expect(result).toEqual({});
      expect(getProviderStatisticsMock).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully and return empty object", async () => {
      getProviderStatisticsMock.mockRejectedValueOnce(new Error("boom"));

      const { getProviderStatisticsAsync } = await import("@/actions/providers");
      const result = await getProviderStatisticsAsync();

      expect(result).toEqual({});
    });
  });

  describe("addProvider", () => {
    it("should not call revalidatePath", async () => {
      const { addProvider } = await import("@/actions/providers");
      const result = await addProvider({
        name: "p2",
        url: "https://api.example.com",
        key: "sk-test-2",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(result.ok).toBe(true);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("should complete quickly without blocking", async () => {
      const { addProvider } = await import("@/actions/providers");
      const start = nowMs();
      await withTimeout(
        addProvider({
          name: "p2",
          url: "https://api.example.com",
          key: "sk-test-2",
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        }),
        500
      );
      const elapsed = nowMs() - start;

      expect(elapsed).toBeLessThan(500);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  // 说明：当前代码实现的函数名为 editProvider/removeProvider。
  // 这里按需求用例命名 describe，但实际调用对应实现以确保测试可编译、可运行。
  describe("updateProvider", () => {
    it("should not call revalidatePath", async () => {
      const { editProvider } = await import("@/actions/providers");
      const result = await editProvider(1, { name: "p1-updated" });

      expect(result.ok).toBe(true);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  describe("deleteProvider", () => {
    it("should not call revalidatePath", async () => {
      const { removeProvider } = await import("@/actions/providers");
      const result = await removeProvider(1);

      expect(result.ok).toBe(true);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });
});
