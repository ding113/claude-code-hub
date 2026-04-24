import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCachedSystemSettingsOnlyCache: vi.fn(),
  getCachedSystemSettings: vi.fn(),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettingsOnlyCache: mocks.getCachedSystemSettingsOnlyCache,
  getCachedSystemSettings: mocks.getCachedSystemSettings,
}));

describe("getClientIp helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getClientIp uses only the in-memory cache and falls back to defaults when cold", async () => {
    mocks.getCachedSystemSettingsOnlyCache.mockReturnValue(null);

    const { getClientIp } = await import("./index");

    expect(getClientIp({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("2.2.2.2");
    expect(mocks.getCachedSystemSettings).not.toHaveBeenCalled();
  });

  it("getClientIpWithFreshSettings reloads settings on a cold cache", async () => {
    mocks.getCachedSystemSettingsOnlyCache.mockReturnValue(null);
    mocks.getCachedSystemSettings.mockResolvedValue({
      ipExtractionConfig: {
        headers: [{ name: "x-forwarded-for", pick: "leftmost" }],
      },
    });

    const { getClientIpWithFreshSettings } = await import("./index");

    await expect(
      getClientIpWithFreshSettings({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })
    ).resolves.toBe("1.1.1.1");
    expect(mocks.getCachedSystemSettings).toHaveBeenCalledTimes(1);
  });
});
