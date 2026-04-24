import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for user leaderboard modelStats (per-user model breakdown).
 *
 * Key difference from provider scope: null model rows are PRESERVED
 * (provider scope at line 570 has `if (!row.model) continue;`).
 */

const createChainMock = (resolvedData: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue(resolvedData),
});

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

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value !== undefined) {
        if (Array.isArray(anyNode.value)) {
          return (anyNode.value as unknown[]).map(walk).join("");
        }
        return walk(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

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
  users: {
    id: "id",
    name: "name",
    deletedAt: "deletedAt",
    tags: "tags",
    providerGroup: "providerGroup",
  },
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

describe("User Leaderboard Model Stats", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
  });

  it("includes modelStats when includeModelStats=true", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 100,
          totalCost: "10.0",
          totalTokens: 50000,
        },
      ]),
      createChainMock([
        {
          userId: 1,
          model: "claude-sonnet-4",
          totalRequests: 60,
          totalCost: "6.0",
          totalTokens: 30000,
        },
        {
          userId: 1,
          model: "claude-opus-4",
          totalRequests: 40,
          totalCost: "4.0",
          totalTokens: 20000,
        },
      ]),
    ];

    const { findDailyLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyLeaderboard(undefined, true);

    expect(result).toHaveLength(1);
    expect(result[0].modelStats).toBeDefined();
    expect(result[0].modelStats).toHaveLength(2);
    expect(result[0].modelStats![0].model).toBe("claude-sonnet-4");
    expect(result[0].modelStats![0].totalCost).toBe(6.0);
    expect(result[0].modelStats![1].model).toBe("claude-opus-4");
    expect(result[0].modelStats![1].totalCost).toBe(4.0);
  });

  it("preserves null model rows (unlike provider scope)", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "bob",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 25000,
        },
      ]),
      createChainMock([
        {
          userId: 1,
          model: "claude-sonnet-4",
          totalRequests: 30,
          totalCost: "3.0",
          totalTokens: 15000,
        },
        {
          userId: 1,
          model: null,
          totalRequests: 20,
          totalCost: "2.0",
          totalTokens: 10000,
        },
      ]),
    ];

    const { findDailyLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyLeaderboard(undefined, true);

    expect(result).toHaveLength(1);
    expect(result[0].modelStats).toHaveLength(2);

    const nullModelStat = result[0].modelStats!.find((s) => s.model === null);
    expect(nullModelStat).toBeDefined();
    expect(nullModelStat!.totalRequests).toBe(20);
    expect(nullModelStat!.totalCost).toBe(2.0);
  });

  it("does not include modelStats when includeModelStats is false/undefined", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "carol",
          totalRequests: 10,
          totalCost: "1.0",
          totalTokens: 5000,
        },
      ]),
    ];

    const { findDailyLeaderboard } = await import("@/repository/leaderboard");

    const resultDefault = await findDailyLeaderboard();
    expect(resultDefault[0].modelStats).toBeUndefined();
    expect(mockSelect).toHaveBeenCalledTimes(1);

    selectCallIndex = 0;
    mockSelect.mockClear();

    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "carol",
          totalRequests: 10,
          totalCost: "1.0",
          totalTokens: 5000,
        },
      ]),
    ];

    const resultFalse = await findDailyLeaderboard(undefined, false);
    expect(resultFalse[0].modelStats).toBeUndefined();
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("groups model stats correctly by userId", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 80,
          totalCost: "8.0",
          totalTokens: 40000,
        },
        {
          userId: 2,
          userName: "bob",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 25000,
        },
      ]),
      createChainMock([
        {
          userId: 1,
          model: "claude-sonnet-4",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 25000,
        },
        {
          userId: 1,
          model: "claude-opus-4",
          totalRequests: 30,
          totalCost: "3.0",
          totalTokens: 15000,
        },
        {
          userId: 2,
          model: "claude-haiku-3.5",
          totalRequests: 50,
          totalCost: "5.0",
          totalTokens: 25000,
        },
      ]),
    ];

    const { findDailyLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyLeaderboard(undefined, true);

    expect(result).toHaveLength(2);

    const alice = result.find((r) => r.userId === 1);
    expect(alice).toBeDefined();
    expect(alice!.modelStats).toHaveLength(2);
    const aliceModels = alice!.modelStats!.map((m) => m.model).sort();
    expect(aliceModels).toEqual(["claude-opus-4", "claude-sonnet-4"]);

    const bob = result.find((r) => r.userId === 2);
    expect(bob).toBeDefined();
    expect(bob!.modelStats).toHaveLength(1);
    expect(bob!.modelStats![0].model).toBe("claude-haiku-3.5");
  });

  it("orders model stats by totalCost descending", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 100,
          totalCost: "15.0",
          totalTokens: 75000,
        },
      ]),
      createChainMock([
        {
          userId: 1,
          model: "expensive-model",
          totalRequests: 30,
          totalCost: "10.0",
          totalTokens: 30000,
        },
        {
          userId: 1,
          model: "cheap-model",
          totalRequests: 70,
          totalCost: "5.0",
          totalTokens: 45000,
        },
      ]),
    ];

    const { findDailyLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyLeaderboard(undefined, true);

    expect(result).toHaveLength(1);
    const stats = result[0].modelStats!;
    expect(stats).toHaveLength(2);
    expect(stats[0].totalCost).toBeGreaterThanOrEqual(stats[1].totalCost);
    expect(stats[0].model).toBe("expensive-model");
    expect(stats[1].model).toBe("cheap-model");
  });
});

describe("User Cache Hit Rate Leaderboard", () => {
  beforeEach(() => {
    vi.resetModules();
    selectCallIndex = 0;
    chainMocks = [];
    mockSelect.mockClear();
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.getSystemSettings.mockResolvedValue({ billingModelSource: "redirected" });
  });

  it("returns user cache hit rankings with stable ordering and base fields", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 30,
          totalCost: "3.0",
          cacheReadTokens: 600,
          cacheCreationCost: "1.0",
          totalInputTokens: 1000,
          cacheHitRate: 0.6,
        },
        {
          userId: 2,
          userName: "bob",
          totalRequests: 30,
          totalCost: "2.0",
          cacheReadTokens: 300,
          cacheCreationCost: "0.5",
          totalInputTokens: 1000,
          cacheHitRate: 0.3,
        },
      ]),
    ];

    const { findDailyUserCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyUserCacheHitRateLeaderboard();

    expect(result).toHaveLength(2);
    expect(result[0].cacheHitRate).toBeGreaterThanOrEqual(result[1].cacheHitRate);
    expect(result[0]).toMatchObject({
      userId: 1,
      userName: "alice",
      totalRequests: 30,
      totalCost: 3,
      cacheReadTokens: 600,
      cacheCreationCost: 1,
      totalInputTokens: 1000,
      totalTokens: 1000,
      cacheHitRate: 0.6,
    });
  });

  it("includes modelStats when includeModelStats=true and preserves null model rows", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 30,
          totalCost: "3.0",
          cacheReadTokens: 600,
          cacheCreationCost: "1.0",
          totalInputTokens: 1000,
          cacheHitRate: 0.6,
        },
      ]),
      createChainMock([
        {
          userId: 1,
          model: "claude-sonnet-4",
          totalRequests: 20,
          cacheReadTokens: 500,
          totalInputTokens: 700,
          cacheHitRate: 0.714,
        },
        {
          userId: 1,
          model: null,
          totalRequests: 10,
          cacheReadTokens: 100,
          totalInputTokens: 300,
          cacheHitRate: 0.333,
        },
      ]),
    ];

    const { findDailyUserCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyUserCacheHitRateLeaderboard(undefined, true);

    expect(result).toHaveLength(1);
    expect(result[0].modelStats).toHaveLength(2);
    expect(result[0].modelStats?.[0].model).toBe("claude-sonnet-4");
    expect(result[0].modelStats?.[0].cacheHitRate).toBeCloseTo(0.714, 3);

    const nullModelStat = result[0].modelStats?.find((item) => item.model === null);
    expect(nullModelStat).toBeDefined();
    expect(nullModelStat?.totalRequests).toBe(10);
    expect(nullModelStat?.cacheReadTokens).toBe(100);
  });

  it("does not query model breakdown when includeModelStats is false", async () => {
    chainMocks = [
      createChainMock([
        {
          userId: 1,
          userName: "alice",
          totalRequests: 10,
          totalCost: "1.0",
          cacheReadTokens: 100,
          cacheCreationCost: "0.2",
          totalInputTokens: 400,
          cacheHitRate: 0.25,
        },
      ]),
    ];

    const { findDailyUserCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    const result = await findDailyUserCacheHitRateLeaderboard(undefined, false);

    expect(result).toHaveLength(1);
    expect(result[0].modelStats).toBeUndefined();
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps chinese comma and newline support in providerGroup filter", async () => {
    const whereArgs: unknown[] = [];
    chainMocks = [
      {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn((arg: unknown) => {
          whereArgs.push(arg);
          return {
            groupBy: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockResolvedValue([]),
          };
        }),
      } as any,
    ];

    const { findDailyUserCacheHitRateLeaderboard } = await import("@/repository/leaderboard");
    await findDailyUserCacheHitRateLeaderboard({ userGroups: ["研发"] }, false);

    expect(whereArgs).toHaveLength(1);
    const whereSql = sqlToString(whereArgs[0]).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    expect(whereSql).toContain("regexp_split_to_array");
    expect(whereSql).toContain("\\s*[,，\\n\\r]+\\s*");
  });
});
