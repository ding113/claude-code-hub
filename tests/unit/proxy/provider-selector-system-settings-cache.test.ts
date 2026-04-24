import { beforeEach, describe, expect, test, vi } from "vitest";

const getSystemSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: getSystemSettingsMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe("provider-selector system settings cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  test("invalidateProviderSelectorSystemSettingsCache clears cached verboseProviderError", async () => {
    getSystemSettingsMock
      .mockResolvedValueOnce({ verboseProviderError: false })
      .mockResolvedValueOnce({ verboseProviderError: true });

    const mod = await import("@/app/v1/_lib/proxy/provider-selector-settings-cache");
    const first = await mod.getVerboseProviderErrorCached();
    expect(first).toBe(false);

    mod.invalidateProviderSelectorSystemSettingsCache();

    const second = await mod.getVerboseProviderErrorCached();
    expect(second).toBe(true);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });
});
