import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCachedSystemSettings: vi.fn(),
  getLeaderboardWithCache: vi.fn(),
  getOrComputeWithRedisLock: vi.fn(),
  findRecentActivityStream: vi.fn(),
  repositoryLeaderboard: {
    findDailyLeaderboard: vi.fn(),
    findDailyProviderLeaderboard: vi.fn(),
    findDailyModelLeaderboard: vi.fn(),
  },
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/redis/cache-aside", () => ({
  getOrComputeWithRedisLock: mocks.getOrComputeWithRedisLock,
}));
vi.mock("@/lib/redis/client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/redis/dashboard-cache-ttl", () => ({
  resolveDashboardCacheTtlSeconds: (defaultTtl: number) => defaultTtl,
}));
vi.mock("@/lib/redis/leaderboard-cache", () => ({
  getLeaderboardWithCache: mocks.getLeaderboardWithCache,
}));
vi.mock("@/repository/activity-stream", () => ({
  findRecentActivityStream: mocks.findRecentActivityStream,
}));
vi.mock("@/repository/leaderboard", () => mocks.repositoryLeaderboard);
vi.mock("@/repository/system-config", () => ({ getSystemSettings: mocks.getSystemSettings }));
vi.mock("@/actions/overview", () => ({
  getOverviewData: vi.fn(async () => ({
    ok: true,
    data: { concurrentSessions: 1, todayRequests: 2 },
  })),
}));
vi.mock("@/actions/provider-slots", () => ({
  getProviderSlots: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/actions/statistics", () => ({
  getUserStatistics: vi.fn(async () => ({ ok: true, data: { chartData: [] } })),
}));

import { getDashboardRealtimeData } from "@/actions/dashboard-realtime";

describe("getDashboardRealtimeData caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 1, role: "admin" } });
    mocks.getCachedSystemSettings.mockResolvedValue({
      allowGlobalUsageView: false,
      currencyDisplay: "CNY",
    });
    mocks.getLeaderboardWithCache.mockResolvedValue([]);
    mocks.getOrComputeWithRedisLock.mockImplementation(
      async (_redis: unknown, options: { compute: () => Promise<unknown> }) => options.compute()
    );
    mocks.findRecentActivityStream.mockResolvedValue([]);
  });

  it("reads leaderboards through the shared leaderboard cache and settings through the process cache", async () => {
    const result = await getDashboardRealtimeData();

    expect(result.ok).toBe(true);
    expect(mocks.getSystemSettings).not.toHaveBeenCalled();
    expect(mocks.getLeaderboardWithCache.mock.calls).toEqual([
      ["daily", "CNY", "user"],
      ["daily", "CNY", "provider"],
      ["daily", "CNY", "model"],
    ]);
    expect(mocks.repositoryLeaderboard.findDailyLeaderboard).not.toHaveBeenCalled();
    expect(mocks.repositoryLeaderboard.findDailyProviderLeaderboard).not.toHaveBeenCalled();
    expect(mocks.repositoryLeaderboard.findDailyModelLeaderboard).not.toHaveBeenCalled();
  });

  it("serves the activity stream through a short Redis cache", async () => {
    await getDashboardRealtimeData();

    expect(mocks.getOrComputeWithRedisLock).toHaveBeenCalledTimes(1);
    const [, options] = mocks.getOrComputeWithRedisLock.mock.calls[0] as [
      unknown,
      { cacheKey: string; ttlSeconds: number },
    ];
    expect(options.cacheKey).toBe("dashboard:activity-stream:v1:20");
    expect(options.ttlSeconds).toBe(3);
    expect(mocks.findRecentActivityStream).toHaveBeenCalledWith(20);
  });

  it("denies users without global view permission before querying data", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 2, role: "user" } });

    const result = await getDashboardRealtimeData();

    expect(result.ok).toBe(false);
    expect(mocks.getLeaderboardWithCache).not.toHaveBeenCalled();
  });
});
