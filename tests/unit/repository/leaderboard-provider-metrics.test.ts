import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GREEN tests for provider leaderboard average cost metrics and cache-hit model breakdown.
 *
 * These tests verify the semantic contracts:
 * - avgCostPerRequest = totalCost / totalRequests (null when totalRequests === 0)
 * - avgCostPerMillionTokens = totalCost * 1_000_000 / totalTokens (null when totalTokens === 0)
 * - ProviderCacheHitRateLeaderboardEntry.modelStats: nested model-level breakdown
 */

const createChainMock = (resolvedData: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue(resolvedData),
});

// Track select calls to return different chains for different queries
let selectCallIndex = 0;
let chainMocks: ReturnType<typeof createChainMock>[] = [];

const mockSelect = vi.fn(() => {
  const chain = chainMocks[selectCallIndex] ?? createChainMock([]);
  selectCallIndex++;
  return chain;
});

const mocks = vi.hoisted(() => ({
  resolveSystemTimezone: vi.fn(),
  getSystemSettings: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  messageRequest: {
    deletedAt: "deletedAt",
    providerId: "providerId",
    userId: "userId",
    costUsd: "costUsd",
    inputTokens: "inputTokens",
    outputTokens: "outputTokens",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    errorMessage: "errorMessage",
    blockedBy: "blockedBy",
    createdAt: "createdAt",
    ttfbMs: "ttfbMs",
    durationMs: "durationMs",
    model: "model",
    originalModel: "originalModel",
  },
  providers: {
    id: "id",
    name: "name",
    deletedAt: "deletedAt",
    providerType: "providerType",
  },
  users: {},
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

describe("Provider Leaderboard Average Cost Metrics", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
  });

  it("computes avgCostPerRequest = totalCost / totalRequests for valid denominators", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "test-provider",
          totalRequests: 100,
          totalCost: "5.0",
          totalTokens: 500000,
          successRate: 0.95,
          avgTtfbMs: 200,
          avgTokensPerSecond: 50,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toHaveProperty("avgCostPerRequest");
    expect(entry.avgCostPerRequest).toBeCloseTo(5.0 / 100);

    type HasAvgCostPerRequest = { avgCostPerRequest: number | null };
    const _typeCheck: HasAvgCostPerRequest = {} as Awaited<
      ReturnType<typeof findDailyProviderLeaderboard>
    >[number];
    expect(_typeCheck).toBeDefined();
  });

  it("computes avgCostPerMillionTokens = totalCost * 1_000_000 / totalTokens for valid denominators", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "test-provider",
          totalRequests: 100,
          totalCost: "5.0",
          totalTokens: 500000,
          successRate: 0.95,
          avgTtfbMs: 200,
          avgTokensPerSecond: 50,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toHaveProperty("avgCostPerMillionTokens");
    expect(entry.avgCostPerMillionTokens).toBeCloseTo((5.0 * 1_000_000) / 500000);
  });

  it("returns null for avgCostPerRequest when totalRequests is 0", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "zero-provider",
          totalRequests: 0,
          totalCost: "0",
          totalTokens: 0,
          successRate: 0,
          avgTtfbMs: 0,
          avgTokensPerSecond: 0,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result).toHaveLength(1);
    expect(result[0].avgCostPerRequest).toBeNull();
  });

  it("returns null for avgCostPerMillionTokens when totalTokens is 0", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "zero-provider",
          totalRequests: 5,
          totalCost: "1.0",
          totalTokens: 0,
          successRate: 0,
          avgTtfbMs: 0,
          avgTokensPerSecond: 0,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result).toHaveLength(1);
    expect(result[0].avgCostPerMillionTokens).toBeNull();
  });

  it("preserves provider sort order by totalCost descending", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "expensive",
          totalRequests: 100,
          totalCost: "10.0",
          totalTokens: 500000,
          successRate: 0.95,
          avgTtfbMs: 200,
          avgTokensPerSecond: 50,
        },
        {
          providerId: 2,
          providerName: "cheap",
          totalRequests: 50,
          totalCost: "2.0",
          totalTokens: 100000,
          successRate: 0.9,
          avgTtfbMs: 300,
          avgTokensPerSecond: 40,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result).toHaveLength(2);
    expect(result[0].totalCost).toBeGreaterThanOrEqual(result[1].totalCost);
  });
});

describe("Provider Cache Hit Rate Model Breakdown", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
  });

  it("includes modelStats field on cache-hit leaderboard entries", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "cache-provider",
          totalRequests: 50,
          totalCost: "2.5",
          cacheReadTokens: 10000,
          cacheCreationCost: "1.0",
          totalInputTokens: 20000,
          cacheHitRate: 0.5,
        },
      ]),
      createChainMock([
        {
          providerId: 1,
          model: "claude-3-opus",
          totalRequests: 30,
          cacheReadTokens: 8000,
          totalInputTokens: 15000,
          cacheHitRate: 0.53,
        },
        {
          providerId: 1,
          model: "claude-3-sonnet",
          totalRequests: 20,
          cacheReadTokens: 2000,
          totalInputTokens: 5000,
          cacheHitRate: 0.4,
        },
      ]),
    ];

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toHaveProperty("modelStats");
    expect(Array.isArray(entry.modelStats)).toBe(true);
    expect(entry.modelStats).toHaveLength(2);
    expect(entry.modelStats[0].model).toBe("claude-3-opus");
  });

  it("provider cache hit ranking sort stability preserved after adding modelStats", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "high-cache",
          totalRequests: 50,
          totalCost: "2.5",
          cacheReadTokens: 15000,
          cacheCreationCost: "1.0",
          totalInputTokens: 20000,
          cacheHitRate: 0.75,
        },
        {
          providerId: 2,
          providerName: "low-cache",
          totalRequests: 30,
          totalCost: "1.0",
          cacheReadTokens: 2000,
          cacheCreationCost: "0.5",
          totalInputTokens: 10000,
          cacheHitRate: 0.2,
        },
      ]),
      createChainMock([]),
    ];

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result).toHaveLength(2);
    expect(result[0].cacheHitRate).toBeGreaterThanOrEqual(result[1].cacheHitRate);
  });

  it("model breakdown excludes empty model names and has deterministic order", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "provider-a",
          totalRequests: 50,
          totalCost: "2.5",
          cacheReadTokens: 10000,
          cacheCreationCost: "1.0",
          totalInputTokens: 20000,
          cacheHitRate: 0.5,
        },
      ]),
      createChainMock([
        {
          providerId: 1,
          model: "claude-3-opus",
          totalRequests: 30,
          cacheReadTokens: 8000,
          totalInputTokens: 15000,
          cacheHitRate: 0.53,
        },
        {
          providerId: 1,
          model: "",
          totalRequests: 5,
          cacheReadTokens: 100,
          totalInputTokens: 500,
          cacheHitRate: 0.2,
        },
        {
          providerId: 1,
          model: "claude-3-sonnet",
          totalRequests: 15,
          cacheReadTokens: 1900,
          totalInputTokens: 4500,
          cacheHitRate: 0.42,
        },
      ]),
    ];

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result).toHaveLength(1);
    const entry = result[0];
    // Empty model names must be excluded (only 2 valid models)
    expect(entry.modelStats).toHaveLength(2);
    for (const ms of entry.modelStats) {
      expect(ms.model).toBeTruthy();
      expect(ms.model.trim()).not.toBe("");
    }
    // Deterministic order: cacheHitRate desc (0.53 > 0.42)
    expect(entry.modelStats[0].cacheHitRate).toBeGreaterThanOrEqual(
      entry.modelStats[entry.modelStats.length - 1].cacheHitRate
    );
  });

  it("preserves all existing provider-level fields unchanged", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "full-provider",
          totalRequests: 50,
          totalCost: "2.5",
          cacheReadTokens: 10000,
          cacheCreationCost: "1.0",
          totalInputTokens: 20000,
          cacheHitRate: 0.5,
        },
      ]),
      createChainMock([]),
    ];

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toHaveProperty("providerId", 1);
    expect(entry).toHaveProperty("providerName", "full-provider");
    expect(entry).toHaveProperty("totalRequests", 50);
    expect(entry).toHaveProperty("cacheReadTokens", 10000);
    expect(entry).toHaveProperty("totalCost", 2.5);
    expect(entry).toHaveProperty("cacheCreationCost", 1.0);
    expect(entry).toHaveProperty("totalInputTokens", 20000);
    expect(entry).toHaveProperty("cacheHitRate", 0.5);
    expect(entry).toHaveProperty("modelStats");
  });

  it("groups model stats correctly across multiple providers", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "provider-alpha",
          totalRequests: 50,
          totalCost: "2.5",
          cacheReadTokens: 10000,
          cacheCreationCost: "1.0",
          totalInputTokens: 20000,
          cacheHitRate: 0.5,
        },
        {
          providerId: 2,
          providerName: "provider-beta",
          totalRequests: 30,
          totalCost: "1.0",
          cacheReadTokens: 5000,
          cacheCreationCost: "0.5",
          totalInputTokens: 10000,
          cacheHitRate: 0.5,
        },
      ]),
      createChainMock([
        {
          providerId: 1,
          model: "model-a",
          totalRequests: 30,
          cacheReadTokens: 6000,
          totalInputTokens: 12000,
          cacheHitRate: 0.5,
        },
        {
          providerId: 1,
          model: "model-b",
          totalRequests: 20,
          cacheReadTokens: 4000,
          totalInputTokens: 8000,
          cacheHitRate: 0.5,
        },
        {
          providerId: 2,
          model: "model-c",
          totalRequests: 30,
          cacheReadTokens: 5000,
          totalInputTokens: 10000,
          cacheHitRate: 0.5,
        },
      ]),
    ];

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result).toHaveLength(2);

    // Provider 1 should have 2 model stats
    const p1 = result.find((r) => r.providerId === 1);
    expect(p1).toBeDefined();
    expect(p1!.modelStats).toHaveLength(2);
    const p1Models = p1!.modelStats.map((m) => m.model).sort();
    expect(p1Models).toEqual(["model-a", "model-b"]);

    // Provider 2 should have 1 model stat
    const p2 = result.find((r) => r.providerId === 2);
    expect(p2).toBeDefined();
    expect(p2!.modelStats).toHaveLength(1);
    expect(p2!.modelStats[0].model).toBe("model-c");
  });
});
