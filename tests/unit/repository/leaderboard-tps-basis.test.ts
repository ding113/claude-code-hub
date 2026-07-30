import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 排行榜的两个延迟指标口径不同，必须分开：
 * - 展示用的 avgTtfbMs 走 usage_ledger.ttfb_ms（该列存的是 TFFT）
 * - avgTokensPerSecond 的分母必须是真 TTFB（first_byte_ms），历史行由 IS NOT NULL 排除
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
    tfftMs: "tfftMs",
    firstByteMs: "firstByteMs",
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
  it("TPS 分母用 first_byte_ms，展示均值仍用 ttfb_ms 列", async () => {
    const { findDailyProviderLeaderboard } = await import("@/repository/leaderboard");
    await findDailyProviderLeaderboard();

    const projection = selectedProjections.find(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && "avgTokensPerSecond" in item
    );
    expect(projection).toBeDefined();

    const tpsSql = JSON.stringify(projection?.avgTokensPerSecond);
    expect(tpsSql).toContain("firstByteMs");
    expect(tpsSql).not.toContain("tfftMs");

    const avgLatencySql = JSON.stringify(projection?.avgTtfbMs);
    expect(avgLatencySql).toContain("tfftMs");
    expect(avgLatencySql).not.toContain("firstByteMs");
  });
});
