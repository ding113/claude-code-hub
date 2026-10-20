import { beforeEach, describe, expect, test, vi } from "vitest";

const getCachedSystemSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: getCachedSystemSettingsMock,
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

  test("复用统一系统设置缓存并读取最新 verboseProviderError", async () => {
    getCachedSystemSettingsMock
      .mockResolvedValueOnce({ verboseProviderError: false })
      .mockResolvedValueOnce({ verboseProviderError: true });

    const mod = await import("@/app/v1/_lib/proxy/provider-selector-settings-cache");
    expect(await mod.getVerboseProviderErrorCached()).toBe(false);
    expect(await mod.getVerboseProviderErrorCached()).toBe(true);
    expect(getCachedSystemSettingsMock).toHaveBeenCalledTimes(2);
  });
});
