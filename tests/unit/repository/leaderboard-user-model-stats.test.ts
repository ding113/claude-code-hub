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
