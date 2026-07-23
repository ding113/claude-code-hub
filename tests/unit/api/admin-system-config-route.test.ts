import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  invalidateAllLeaderboardCaches: vi.fn(),
  invalidateAllOverviewCaches: vi.fn(),
  invalidateAllStatisticsCaches: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
  updateSystemSettings: mocks.updateSystemSettings,
}));

describe("POST /api/admin/system-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 1, role: "admin" } });
    mocks.getSystemSettings.mockResolvedValue({
      discoverySlaMs: 10_000,
      stickySlaMs: 20_000,
      maxDiscoveryRounds: 2,
      racingTotalTimeoutMs: 60_000,
    });
  });

  it("returns the stable Discovery window code for an invalid partial update", async () => {
    const { POST } = await import("@/app/api/admin/system-config/route");
    const response = await POST(
      new Request("http://localhost/api/admin/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ racingTotalTimeoutMs: 39_999 }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "discoveryWindowInvalid",
      errorCode: "DISCOVERY_WINDOW_INVALID",
    });
    expect(mocks.updateSystemSettings).not.toHaveBeenCalled();
  });

  it("returns the same stable Discovery window code for a complete update", async () => {
    const { POST } = await import("@/app/api/admin/system-config/route");
    const response = await POST(
      new Request("http://localhost/api/admin/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discoverySlaMs: 10_000,
          stickySlaMs: 20_000,
          maxDiscoveryRounds: 2,
          racingTotalTimeoutMs: 39_999,
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "discoveryWindowInvalid",
      errorCode: "DISCOVERY_WINDOW_INVALID",
    });
    expect(mocks.updateSystemSettings).not.toHaveBeenCalled();
  });

  it("returns the stable Discovery settings code for an out-of-range field", async () => {
    const { POST } = await import("@/app/api/admin/system-config/route");
    const response = await POST(
      new Request("http://localhost/api/admin/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoveryConcurrency: 33 }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "discoverySettingsInvalid",
      errorCode: "DISCOVERY_SETTINGS_INVALID",
    });
    expect(mocks.updateSystemSettings).not.toHaveBeenCalled();
  });
});
