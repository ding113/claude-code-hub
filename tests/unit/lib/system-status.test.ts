import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryProviderAvailability: vi.fn(),
  getLeaderboardWithCache: vi.fn(),
  getSystemSettings: vi.fn(),
  resolveSystemTimezone: vi.fn(),
}));

vi.mock("@/lib/availability", () => ({
  queryProviderAvailability: mocks.queryProviderAvailability,
}));

vi.mock("@/lib/redis", () => ({
  getLeaderboardWithCache: mocks.getLeaderboardWithCache,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

describe("getPublicSystemStatusSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemSettings.mockResolvedValue({ currencyDisplay: "USD" });
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
  });

  it("merges availability, cache hit, and provider efficiency metrics into a public snapshot", async () => {
    mocks.queryProviderAvailability.mockResolvedValue({
      queriedAt: "2026-04-15T12:00:00.000Z",
      startTime: "2026-04-08T12:00:00.000Z",
      endTime: "2026-04-15T12:00:00.000Z",
      bucketSizeMinutes: 180,
      systemAvailability: 0.8,
      providers: [
        {
          providerId: 2,
          providerName: "Codex Fast",
          providerType: "codex",
          isEnabled: true,
          currentStatus: "red",
          currentAvailability: 0.2,
          totalRequests: 10,
          successRate: 0.3,
          avgLatencyMs: 1450,
          lastRequestAt: "2026-04-15T11:58:00.000Z",
          timeBuckets: [
            {
              bucketStart: "2026-04-15T08:00:00.000Z",
              availabilityScore: 0.2,
              totalRequests: 5,
            },
          ],
        },
        {
          providerId: 1,
          providerName: "Claude Prime",
          providerType: "claude",
          isEnabled: true,
          currentStatus: "green",
          currentAvailability: 0.95,
          totalRequests: 90,
          successRate: 0.97,
          avgLatencyMs: 640,
          lastRequestAt: "2026-04-15T11:59:00.000Z",
          timeBuckets: [
            {
              bucketStart: "2026-04-15T08:00:00.000Z",
              availabilityScore: 1,
              totalRequests: 30,
            },
          ],
        },
      ],
    });

    mocks.getLeaderboardWithCache.mockImplementation(
      async (_period: string, _currency: string, scope: string) => {
        if (scope === "provider") {
          return [
            {
              providerId: 1,
              providerName: "Claude Prime",
              totalRequests: 90,
              totalCost: 225,
              totalTokens: 18_000_000,
              successRate: 0.97,
              avgTtfbMs: 300,
              avgTokensPerSecond: 140,
              avgCostPerRequest: 2.5,
              avgCostPerMillionTokens: 12.5,
            },
            {
              providerId: 2,
              providerName: "Codex Fast",
              totalRequests: 10,
              totalCost: 60,
              totalTokens: 3_000_000,
              successRate: 0.3,
              avgTtfbMs: 900,
              avgTokensPerSecond: 40,
              avgCostPerRequest: 6,
              avgCostPerMillionTokens: 20,
            },
          ];
        }

        return [
          {
            providerId: 1,
            providerName: "Claude Prime",
            totalRequests: 90,
            cacheReadTokens: 1000,
            totalCost: 225,
            cacheCreationCost: 20,
            totalInputTokens: 5000,
            totalTokens: 5000,
            cacheHitRate: 0.72,
            modelStats: [],
          },
          {
            providerId: 2,
            providerName: "Codex Fast",
            totalRequests: 10,
            cacheReadTokens: 120,
            totalCost: 60,
            cacheCreationCost: 5,
            totalInputTokens: 800,
            totalTokens: 800,
            cacheHitRate: 0.25,
            modelStats: [],
          },
        ];
      }
    );

    const { getPublicSystemStatusSnapshot } = await import("@/lib/system-status");
    const snapshot = await getPublicSystemStatusSnapshot(new Date("2026-04-15T12:00:00.000Z"));

    expect(snapshot.currencyDisplay).toBe("USD");
    expect(snapshot.windowDays).toBe(7);
    expect(snapshot.providers.map((provider) => provider.providerName)).toEqual([
      "Codex Fast",
      "Claude Prime",
    ]);
    expect(snapshot.providers[0]).toMatchObject({
      providerId: 2,
      cacheHitRate: 0.25,
      avgTokensPerSecond: 40,
      avgCostPerMillionTokens: 20,
      avgCostPerHundredMillionTokens: 2000,
    });
    expect(snapshot.providers[1]).toMatchObject({
      providerId: 1,
      cacheHitRate: 0.72,
      avgTokensPerSecond: 140,
      avgCostPerMillionTokens: 12.5,
      avgCostPerHundredMillionTokens: 1250,
    });
    expect(snapshot.summary).toMatchObject({
      systemAvailability: 0.8,
      providerCount: 2,
      healthyCount: 1,
      degradedCount: 1,
      unknownCount: 0,
    });
    expect(snapshot.summary.weightedCacheHitRate).toBeCloseTo(0.673, 3);
    expect(snapshot.summary.weightedTokensPerSecond).toBeCloseTo(130, 3);
    expect(snapshot.summary.weightedCostPerMillionTokens).toBeCloseTo(13.25, 3);
    expect(snapshot.summary.weightedCostPerHundredMillionTokens).toBeCloseTo(1325, 3);
    expect(mocks.getLeaderboardWithCache).toHaveBeenCalledWith("custom", "USD", "provider", {
      startDate: "2026-04-09",
      endDate: "2026-04-15",
    });
  });
});
