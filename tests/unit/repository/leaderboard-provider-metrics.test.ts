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
  getProviderCacheCoefficients: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  usageLedger: {
    providerId: "providerId",
    finalProviderId: "finalProviderId",
    userId: "userId",
    costUsd: "costUsd",
    inputTokens: "inputTokens",
    outputTokens: "outputTokens",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    isSuccess: "isSuccess",
    successRateOutcome: "successRateOutcome",
    blockedBy: "blockedBy",
    createdAt: "createdAt",
    ttfbMs: "ttfbMs",
    durationMs: "durationMs",
    model: "model",
    originalModel: "originalModel",
  },
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

vi.mock("@/repository/provider-cache-effectiveness", () => ({
  getProviderCacheCoefficients: mocks.getProviderCacheCoefficients,
  resolveLeaderboardWindow: () => ({ start: new Date(0), end: new Date() }),
}));

/** 构造 getProviderCacheCoefficients 返回的 Map */
function coefficientMap(entries: Array<{ providerId: number; coefficientBp: number }>) {
  return new Map(entries.map((e) => [e.providerId, { ...e, sampleCount: 100 }] as const));
}

describe("Provider Leaderboard Average Cost Metrics", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
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

  it("preserves null successRate when a provider has no countable samples", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "excluded-only",
          totalRequests: 4,
          totalCost: "1.0",
          totalTokens: 1000,
          successRate: null,
          avgTtfbMs: 200,
          avgTokensPerSecond: 10,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result[0]?.successRate).toBeNull();
  });
});

describe("Provider Leaderboard Model Breakdown", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
  });

  it("includes modelStats when includeModelStats=true and excludes empty model names", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "provider-a",
          totalRequests: 100,
          totalCost: "10.0",
          totalTokens: 1000,
          successRate: 0.9,
          avgTtfbMs: 200,
          avgTokensPerSecond: 50,
        },
        {
          providerId: 2,
          providerName: "provider-b",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 500,
          successRate: 0.8,
          avgTtfbMs: 300,
          avgTokensPerSecond: 40,
        },
      ]),
      createChainMock([
        {
          providerId: 1,
          model: "model-a",
          totalRequests: 60,
          totalCost: "6.0",
          totalTokens: 600,
          successRate: 0.95,
          avgTtfbMs: 120,
          avgTokensPerSecond: 55,
        },
        {
          providerId: 1,
          model: "model-b",
          totalRequests: 40,
          totalCost: "4.0",
          totalTokens: 400,
          successRate: 0.85,
          avgTtfbMs: 180,
          avgTokensPerSecond: 45,
        },
        {
          providerId: 2,
          model: "",
          totalRequests: 1,
          totalCost: "0.1",
          totalTokens: 10,
          successRate: 0,
          avgTtfbMs: 0,
          avgTokensPerSecond: 0,
        },
        {
          providerId: 2,
          model: "model-c",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 500,
          successRate: 0.8,
          avgTtfbMs: 300,
          avgTokensPerSecond: 40,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard(undefined, true);

    expect(result).toHaveLength(2);

    const p1 = result.find((r) => r.providerId === 1);
    expect(p1).toBeDefined();
    expect(p1!.modelStats).toBeDefined();
    expect(p1!.modelStats).toHaveLength(2);
    expect(p1!.modelStats![0].model).toBe("model-a");
    expect(p1!.modelStats![0].avgCostPerRequest).toBeCloseTo(6.0 / 60);
    expect(p1!.modelStats![0].avgCostPerMillionTokens).toBeCloseTo((6.0 * 1_000_000) / 600);

    const p2 = result.find((r) => r.providerId === 2);
    expect(p2).toBeDefined();
    // Empty model must be excluded
    expect(p2!.modelStats).toHaveLength(1);
    expect(p2!.modelStats![0].model).toBe("model-c");
  });

  it("marks model-grain successRate as unavailable when billingModelSource is redirected", async () => {
    chainMocks = [
      createChainMock([
        {
          providerId: 1,
          providerName: "provider-a",
          totalRequests: 10,
          totalCost: "1.0",
          totalTokens: 100,
          successRate: 0.9,
          avgTtfbMs: 100,
          avgTokensPerSecond: 10,
        },
      ]),
      createChainMock([
        {
          providerId: 1,
          model: "redirected-model",
          totalRequests: 10,
          totalCost: "1.0",
          totalTokens: 100,
          successRate: 0.9,
          avgTtfbMs: 100,
          avgTokensPerSecond: 10,
        },
      ]),
    ];

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard(undefined, true);
    const modelStat = result[0]?.modelStats?.[0];

    expect(modelStat).toMatchObject({
      model: "redirected-model",
      successRate: null,
      rowIdentityBasis: "redirected",
      successRateBasis: "unavailable",
      costTokensBasis: "redirected",
      basisDisclosureRequired: true,
      successRateUnavailableReason: "redirected_billing_model",
    });
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
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
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

  it("falls back to cacheHitRate descending when no provider has a cache coefficient", async () => {
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
    // 默认排序为 cacheCoefficientBp DESC NULLS LAST；全 null 时并列，按 cacheHitRate DESC
    expect(result.map((r) => r.cacheCoefficientBp)).toEqual([null, null]);
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

describe("Provider Leaderboard Cache Coefficient", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
  });

  const usageRow = (providerId: number, providerName: string, totalCost: string) => ({
    providerId,
    providerName,
    totalRequests: 10,
    totalCost,
    totalTokens: 1000,
    successRate: 0.9,
    avgTtfbMs: 100,
    avgTokensPerSecond: 10,
  });

  const cacheRow = (providerId: number, providerName: string, cacheHitRate: number) => ({
    providerId,
    providerName,
    totalRequests: 10,
    totalCost: "1.0",
    cacheReadTokens: 1000,
    cacheCreationCost: "0.5",
    totalInputTokens: 2000,
    cacheHitRate,
  });

  it("merges coefficientBp into usage entries and keeps null for providers without data", async () => {
    chainMocks = [
      createChainMock([usageRow(1, "with-data", "10.0"), usageRow(2, "no-data", "5.0")]),
    ];
    mocks.getProviderCacheCoefficients.mockResolvedValue(
      coefficientMap([{ providerId: 1, coefficientBp: 8600 }])
    );

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result.find((r) => r.providerId === 1)?.cacheCoefficientBp).toBe(8600);
    expect(result.find((r) => r.providerId === 2)?.cacheCoefficientBp).toBeNull();
  });

  it("usage leaderboard keeps cost descending order even when coefficients disagree", async () => {
    chainMocks = [createChainMock([usageRow(1, "expensive", "10.0"), usageRow(2, "cheap", "2.0")])];
    mocks.getProviderCacheCoefficients.mockResolvedValue(
      coefficientMap([
        { providerId: 1, coefficientBp: 100 },
        { providerId: 2, coefficientBp: 9900 },
      ])
    );

    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderLeaderboard();

    expect(result.map((r) => r.providerId)).toEqual([1, 2]);
    expect(result.map((r) => r.cacheCoefficientBp)).toEqual([100, 9900]);
  });

  it("cache hit leaderboard sorts by coefficientBp descending with nulls last", async () => {
    chainMocks = [
      createChainMock([
        cacheRow(1, "high-hit-no-coefficient", 0.9),
        cacheRow(2, "low-hit-high-coefficient", 0.3),
        cacheRow(3, "mid-hit-low-coefficient", 0.6),
      ]),
      createChainMock([]),
    ];
    mocks.getProviderCacheCoefficients.mockResolvedValue(
      coefficientMap([
        { providerId: 2, coefficientBp: 9000 },
        { providerId: 3, coefficientBp: 2000 },
      ])
    );

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    // coefficient DESC，无系数的 provider 1 排最后
    expect(result.map((r) => r.providerId)).toEqual([2, 3, 1]);
    expect(result.map((r) => r.cacheCoefficientBp)).toEqual([9000, 2000, null]);
  });

  it("cache hit leaderboard breaks coefficient ties by cacheHitRate descending", async () => {
    chainMocks = [
      createChainMock([cacheRow(1, "low-hit", 0.2), cacheRow(2, "high-hit", 0.8)]),
      createChainMock([]),
    ];
    mocks.getProviderCacheCoefficients.mockResolvedValue(
      coefficientMap([
        { providerId: 1, coefficientBp: 5000 },
        { providerId: 2, coefficientBp: 5000 },
      ])
    );

    const { findDailyProviderCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyProviderCacheHitRateLeaderboard();

    expect(result.map((r) => r.providerId)).toEqual([2, 1]);
  });
});

describe("Model Leaderboard basis handling", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
  });

  it("marks top-level model successRate as unavailable when billingModelSource is redirected", async () => {
    chainMocks = [
      createChainMock([
        {
          model: "redirected-model",
          totalRequests: 12,
          totalCost: "3.0",
          totalTokens: 1200,
          successRate: 0.8,
        },
      ]),
    ];

    const { findDailyModelLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyModelLeaderboard();

    expect(result[0]).toMatchObject({
      model: "redirected-model",
      successRate: null,
      rowIdentityBasis: "redirected",
      successRateBasis: "unavailable",
      costTokensBasis: "redirected",
      basisDisclosureRequired: true,
      successRateUnavailableReason: "redirected_billing_model",
    });
  });
});

describe("Model Leaderboard sort order", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
    mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
  });

  it("orders by total cost descending with request count as tiebreaker", async () => {
    chainMocks = [
      createChainMock([
        {
          model: "expensive-low-volume",
          totalRequests: 5,
          totalCost: "50.0",
          totalTokens: 1000,
          successRate: 1.0,
        },
        {
          model: "cheap-high-volume",
          totalRequests: 200,
          totalCost: "1.0",
          totalTokens: 100000,
          successRate: 1.0,
        },
      ]),
    ];

    const { findDailyModelLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyModelLeaderboard();

    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("expensive-low-volume");
    expect(result[0].totalCost).toBe(50);
    expect(result[1].model).toBe("cheap-high-volume");
    expect(result[1].totalCost).toBe(1);

    const orderByMock = chainMocks[0].orderBy;
    expect(orderByMock).toHaveBeenCalledTimes(1);

    const args = orderByMock.mock.calls[0];
    expect(args).toHaveLength(2);
    expect(JSON.stringify(args[0])).toContain("sum");
    expect(JSON.stringify(args[1])).toContain("count");
  });
});
