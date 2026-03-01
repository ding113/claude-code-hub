import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getLeaderboardWithCache: vi.fn(),
  getSystemSettings: vi.fn(),
  formatCurrency: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/utils", () => ({
  formatCurrency: mocks.formatCurrency,
}));

vi.mock("@/lib/redis", () => ({
  getLeaderboardWithCache: mocks.getLeaderboardWithCache,
}));

describe("GET /api/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formatCurrency.mockImplementation((val: number) => String(val));
    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      allowGlobalUsageView: true,
    });
    mocks.getLeaderboardWithCache.mockResolvedValue([]);
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSession.mockResolvedValue(null);

    const { GET } = await import("@/app/api/leaderboard/route");
    const url = "http://localhost/api/leaderboard";
    const response = await GET({ nextUrl: new URL(url) } as any);

    expect(response.status).toBe(401);
  });

  it("parses and trims userTags/userGroups and caps at 20 items", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });

    const tags = Array.from({ length: 25 }, (_, i) => ` t${i} `).join(",");
    const groups = " a, ,b ,c, ";

    const { GET } = await import("@/app/api/leaderboard/route");
    const url = `http://localhost/api/leaderboard?scope=user&period=daily&userTags=${encodeURIComponent(
      tags
    )}&userGroups=${encodeURIComponent(groups)}`;
    const response = await GET({ nextUrl: new URL(url) } as any);

    expect(response.status).toBe(200);

    expect(mocks.getLeaderboardWithCache).toHaveBeenCalledTimes(1);
    const callArgs = mocks.getLeaderboardWithCache.mock.calls[0];

    const options = callArgs[4];
    expect(options.userTags).toHaveLength(20);
    expect(options.userTags?.[0]).toBe("t0");
    expect(options.userGroups).toEqual(["a", "b", "c"]);
  });

  it("does not apply userTags/userGroups when scope is not user", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });

    const { GET } = await import("@/app/api/leaderboard/route");
    const url =
      "http://localhost/api/leaderboard?scope=provider&period=daily&userTags=a&userGroups=b";
    const response = await GET({ nextUrl: new URL(url) } as any);

    expect(response.status).toBe(200);

    expect(mocks.getLeaderboardWithCache).toHaveBeenCalledTimes(1);
    const callArgs = mocks.getLeaderboardWithCache.mock.calls[0];
    const options = callArgs[4];
    expect(options.userTags).toBeUndefined();
    expect(options.userGroups).toBeUndefined();
  });

  describe("additive provider fields", () => {
    it("includes avgCostPerRequest and avgCostPerMillionTokens in provider scope response", async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });
      mocks.getLeaderboardWithCache.mockResolvedValue([
        {
          providerId: 1,
          providerName: "test-provider",
          totalRequests: 100,
          totalCost: 5.0,
          totalTokens: 500000,
          successRate: 0.95,
          avgTtfbMs: 200,
          avgTokensPerSecond: 50,
          avgCostPerRequest: 0.05,
          avgCostPerMillionTokens: 10.0,
        },
      ]);

      const { GET } = await import("@/app/api/leaderboard/route");
      const url = "http://localhost/api/leaderboard?scope=provider&period=daily";
      const response = await GET({ nextUrl: new URL(url) } as any);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);

      const entry = body[0];
      // Additive fields must be present
      expect(entry).toHaveProperty("avgCostPerRequest", 0.05);
      expect(entry).toHaveProperty("avgCostPerMillionTokens", 10.0);
      // Formatted variants should exist
      expect(entry).toHaveProperty("avgCostPerRequestFormatted");
      expect(entry).toHaveProperty("avgCostPerMillionTokensFormatted");
      // Existing fields must still be present
      expect(entry).toHaveProperty("totalCostFormatted");
      expect(entry).toHaveProperty("providerId", 1);
      expect(entry).toHaveProperty("providerName", "test-provider");
    });

    it("formats null avgCost fields without error", async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });
      mocks.getLeaderboardWithCache.mockResolvedValue([
        {
          providerId: 2,
          providerName: "zero-provider",
          totalRequests: 0,
          totalCost: 0,
          totalTokens: 0,
          successRate: 0,
          avgTtfbMs: 0,
          avgTokensPerSecond: 0,
          avgCostPerRequest: null,
          avgCostPerMillionTokens: null,
        },
      ]);

      const { GET } = await import("@/app/api/leaderboard/route");
      const url = "http://localhost/api/leaderboard?scope=provider&period=daily";
      const response = await GET({ nextUrl: new URL(url) } as any);
      const body = await response.json();

      expect(response.status).toBe(200);
      const entry = body[0];
      expect(entry.avgCostPerRequest).toBeNull();
      expect(entry.avgCostPerMillionTokens).toBeNull();
    });

    it("includes modelStats in providerCacheHitRate scope response", async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });
      mocks.getLeaderboardWithCache.mockResolvedValue([
        {
          providerId: 1,
          providerName: "cache-provider",
          totalRequests: 50,
          cacheReadTokens: 10000,
          totalCost: 2.5,
          cacheCreationCost: 1.0,
          totalInputTokens: 20000,
          totalTokens: 20000,
          cacheHitRate: 0.5,
          modelStats: [
            {
              model: "claude-3-opus",
              totalRequests: 30,
              cacheReadTokens: 8000,
              totalInputTokens: 15000,
              cacheHitRate: 0.53,
            },
            {
              model: "claude-3-sonnet",
              totalRequests: 20,
              cacheReadTokens: 2000,
              totalInputTokens: 5000,
              cacheHitRate: 0.4,
            },
          ],
        },
      ]);

      const { GET } = await import("@/app/api/leaderboard/route");
      const url = "http://localhost/api/leaderboard?scope=providerCacheHitRate&period=daily";
      const response = await GET({ nextUrl: new URL(url) } as any);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);

      const entry = body[0];
      expect(entry).toHaveProperty("modelStats");
      expect(entry.modelStats).toHaveLength(2);
      expect(entry.modelStats[0]).toHaveProperty("model", "claude-3-opus");
      expect(entry.modelStats[0]).toHaveProperty("cacheHitRate", 0.53);
    });

    it("passes includeModelStats to cache and formats provider modelStats entries", async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 1, name: "u", role: "admin" } });
      mocks.getLeaderboardWithCache.mockResolvedValue([
        {
          providerId: 1,
          providerName: "test-provider",
          totalRequests: 10,
          totalCost: 1.5,
          totalTokens: 1000,
          successRate: 1,
          avgTtfbMs: 100,
          avgTokensPerSecond: 20,
          avgCostPerRequest: 0.15,
          avgCostPerMillionTokens: 1500,
          modelStats: [
            {
              model: "model-a",
              totalRequests: 6,
              totalCost: 1.0,
              totalTokens: 600,
              successRate: 1,
              avgTtfbMs: 110,
              avgTokensPerSecond: 25,
              avgCostPerRequest: 0.1667,
              avgCostPerMillionTokens: 1666.7,
            },
          ],
        },
      ]);

      const { GET } = await import("@/app/api/leaderboard/route");
      const url =
        "http://localhost/api/leaderboard?scope=provider&period=daily&includeModelStats=1";
      const response = await GET({ nextUrl: new URL(url) } as any);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.getLeaderboardWithCache).toHaveBeenCalledTimes(1);

      const callArgs = mocks.getLeaderboardWithCache.mock.calls[0];
      const options = callArgs[4];
      expect(options.includeModelStats).toBe(true);

      expect(body).toHaveLength(1);
      const entry = body[0];
      expect(entry).toHaveProperty("modelStats");
      expect(entry.modelStats).toHaveLength(1);
      expect(entry.modelStats[0]).toHaveProperty("totalCostFormatted");
      expect(entry.modelStats[0]).toHaveProperty("avgCostPerRequestFormatted");
      expect(entry.modelStats[0]).toHaveProperty("avgCostPerMillionTokensFormatted");
    });
  });
});
