import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 排行榜的延迟指标必须分开：
 * - avgTtfbMs 使用响应头到达时间
 * - avgTtftMs 使用首个有效内容到达时间
 * - avgTokensPerSecond 的生成窗口从 TTFT 开始
 */

const createChainMock = (resolvedData: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue(resolvedData),
});

let selectedProjections: unknown[] = [];
const mockSelect = vi.fn((projection: unknown) => {
  selectedProjections.push(projection);
  return createChainMock([]);
});

const mocks = vi.hoisted(() => ({
  resolveSystemTimezone: vi.fn(),
  getSystemSettings: vi.fn(),
  getProviderCacheCoefficients: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(args[0]),
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
    ttftMs: "ttftMs",
    timingSemanticsVersion: "timingSemanticsVersion",
    durationMs: "durationMs",
    model: "model",
    originalModel: "originalModel",
  },
  providers: { id: "id", name: "name" },
  users: { id: "id", name: "name" },
  messageRequest: {},
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

beforeEach(() => {
  vi.clearAllMocks();
  selectedProjections = [];
  mocks.resolveSystemTimezone.mockResolvedValue("UTC");
  mocks.getSystemSettings.mockResolvedValue({ timezone: "UTC" });
  mocks.getProviderCacheCoefficients.mockResolvedValue(new Map());
});

describe("排行榜延迟指标口径", () => {
  it("TPS 使用 TTFT 生成窗口，并分别聚合 TTFB 与 TTFT", async () => {
    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    await findDailyProviderLeaderboard();

    const projection = selectedProjections.find(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && "avgTokensPerSecond" in item
    );
    expect(projection).toBeDefined();

    const tpsSql = JSON.stringify(projection?.avgTokensPerSecond);
    expect(tpsSql).toContain("ttftMs");
    expect(tpsSql).not.toContain("ttfbMs");
    expect(tpsSql).toContain("timingSemanticsVersion");

    const avgTtfbSql = JSON.stringify(projection?.avgTtfbMs);
    expect(avgTtfbSql).toContain("ttfbMs");
    expect(avgTtfbSql).not.toContain("ttftMs");

    const avgTtftSql = JSON.stringify(projection?.avgTtftMs);
    expect(avgTtftSql).toContain("ttftMs");
    expect(avgTtftSql).not.toContain("ttfbMs");
  });
});
