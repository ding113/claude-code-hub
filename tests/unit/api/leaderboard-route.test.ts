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
});
