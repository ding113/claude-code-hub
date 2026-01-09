import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

const getSystemSettingsMock = vi.fn();

const loggerDebugMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: loggerDebugMock,
    warn: loggerWarnMock,
    info: loggerInfoMock,
    trace: vi.fn(),
    error: vi.fn(),
  },
}));

function createSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  const base: SystemSettings = {
    id: 1,
    siteTitle: "Claude Code Hub",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    interceptAnthropicWarmupRequests: false,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return { ...base, ...overrides };
}

async function loadCache() {
  const mod = await import("@/lib/config/system-settings-cache");
  return {
    getCachedSystemSettings: mod.getCachedSystemSettings,
    isHttp2Enabled: mod.isHttp2Enabled,
    invalidateSystemSettingsCache: mod.invalidateSystemSettingsCache,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SystemSettingsCache", () => {
  test("首次调用应从数据库获取并缓存；TTL 内再次调用应直接返回缓存", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(createSettings({ id: 101 }));
    const { getCachedSystemSettings } = await loadCache();

    const first = await getCachedSystemSettings();
    const second = await getCachedSystemSettings();

    expect(first).toEqual(expect.objectContaining({ id: 101 }));
    // 缓存返回应保持引用一致，避免不必要的对象创建
    expect(second).toBe(first);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(1);
    expect(loggerDebugMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  test("TTL 过期后应重新获取并更新缓存", async () => {
    const settingsA = createSettings({ id: 201, enableHttp2: false });
    const settingsB = createSettings({ id: 202, enableHttp2: true });
    getSystemSettingsMock.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB);

    const { getCachedSystemSettings } = await loadCache();

    const first = await getCachedSystemSettings();
    expect(first).toBe(settingsA);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-03T00:01:00.001Z"));
    const second = await getCachedSystemSettings();
    expect(second).toBe(settingsB);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  test("当获取失败且已有缓存时，应 fail-open 返回上一份缓存", async () => {
    const cached = createSettings({ id: 301, interceptAnthropicWarmupRequests: true });
    getSystemSettingsMock.mockResolvedValueOnce(cached);

    const { getCachedSystemSettings } = await loadCache();

    const first = await getCachedSystemSettings();
    expect(first).toBe(cached);

    vi.setSystemTime(new Date("2026-01-03T00:01:00.001Z"));
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));

    const second = await getCachedSystemSettings();
    expect(second).toBe(cached);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test("当获取失败且无缓存时，应返回最小默认设置，并显式关闭 warmup 拦截", async () => {
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await loadCache();

    const settings = await getCachedSystemSettings();
    expect(settings).toEqual(
      expect.objectContaining({
        siteTitle: "Claude Code Hub",
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
      })
    );
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test("invalidateSystemSettingsCache 应清空缓存并触发下一次重新获取", async () => {
    const settingsA = createSettings({ id: 401 });
    const settingsB = createSettings({ id: 402 });
    getSystemSettingsMock.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB);

    const { getCachedSystemSettings, invalidateSystemSettingsCache } = await loadCache();

    expect(await getCachedSystemSettings()).toBe(settingsA);

    invalidateSystemSettingsCache();
    expect(loggerInfoMock).toHaveBeenCalledTimes(1);

    expect(await getCachedSystemSettings()).toBe(settingsB);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  test("isHttp2Enabled 应读取缓存并返回 enableHttp2", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(createSettings({ id: 501, enableHttp2: true }));
    const { isHttp2Enabled } = await loadCache();

    expect(await isHttp2Enabled()).toBe(true);
  });
});
