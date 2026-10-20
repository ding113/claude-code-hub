import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

const getSystemSettingsMock = vi.fn();

const loggerDebugMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();
const pubsubHarness = vi.hoisted(() => ({
  callback: null as ((message: string) => void) | null,
  cleanup: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
}));

const originalResponsesWebsocketEnv = process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET;
const originalStreamGateMode = process.env.STREAM_GATE_MODE;
const originalSessionTtl = process.env.SESSION_TTL;

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

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_SYSTEM_SETTINGS_UPDATED: "cch:cache:system_settings:updated",
  publishCacheInvalidation: pubsubHarness.publish,
  subscribeCacheInvalidation: pubsubHarness.subscribe,
}));

function createSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  const base: SystemSettings = {
    id: 1,
    siteTitle: "CC Hub",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    codexPriorityBillingSource: "requested",
    legacyHedgeMaxInFlight: 2,
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: true,
    enableHttp2: false,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    },
    quotaDbRefreshIntervalSeconds: 10,
    quotaLeasePercent5h: 0.05,
    quotaLeasePercentDaily: 0.05,
    quotaLeasePercentWeekly: 0.05,
    quotaLeasePercentMonthly: 0.05,
    quotaLeaseCapUsd: null,
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
    isOpenaiResponsesWebsocketEnabled: mod.isOpenaiResponsesWebsocketEnabled,
    invalidateSystemSettingsCache: mod.invalidateSystemSettingsCache,
    ensureSystemSettingsCacheSubscription: mod.ensureSystemSettingsCacheSubscription,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
  delete process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET;
  pubsubHarness.callback = null;
  pubsubHarness.publish.mockResolvedValue(undefined);
  pubsubHarness.subscribe.mockImplementation(
    async (_channel: string, callback: (message: string) => void) => {
      pubsubHarness.callback = callback;
      return pubsubHarness.cleanup;
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  if (originalResponsesWebsocketEnv === undefined) {
    delete process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET;
  } else {
    process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET = originalResponsesWebsocketEnv;
  }
  if (originalStreamGateMode === undefined) {
    delete process.env.STREAM_GATE_MODE;
  } else {
    process.env.STREAM_GATE_MODE = originalStreamGateMode;
  }
  if (originalSessionTtl === undefined) {
    delete process.env.SESSION_TTL;
  } else {
    process.env.SESSION_TTL = originalSessionTtl;
  }
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
        siteTitle: "CC Hub",
        enableHttp2: false,
        enableHighConcurrencyMode: false,
        interceptAnthropicWarmupRequests: false,
        codexPriorityBillingSource: "requested",
        passThroughUpstreamErrorMessage: true,
      })
    );
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test("冷缓存读取失败时保留显式 STREAM_GATE_MODE=off", async () => {
    process.env.STREAM_GATE_MODE = "off";
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await loadCache();

    const settings = await getCachedSystemSettings();
    expect(settings.streamGateMode).toBe("off");
  });

  test("其他环境变量无效时，冷缓存回退仍强制开启 Stream Gate 并记录告警", async () => {
    delete process.env.STREAM_GATE_MODE;
    process.env.SESSION_TTL = "invalid";
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await loadCache();

    const settings = await getCachedSystemSettings();

    expect(settings.streamGateMode).toBe("enforce");
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[SystemSettingsCache] Invalid environment fallback, using Stream Gate enforce",
      expect.objectContaining({ value: undefined })
    );
  });

  test.each(["off", "shadow"] as const)(
    "其他环境变量无效时仍保留显式 STREAM_GATE_MODE=%s",
    async (streamGateMode) => {
      process.env.STREAM_GATE_MODE = streamGateMode;
      process.env.SESSION_TTL = "invalid";
      getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
      const { getCachedSystemSettings } = await loadCache();

      const settings = await getCachedSystemSettings();

      expect(settings.streamGateMode).toBe(streamGateMode);
    }
  );

  test("invalidateSystemSettingsCache 应清空缓存并触发下一次重新获取", async () => {
    const settingsA = createSettings({ id: 401 });
    const settingsB = createSettings({ id: 402 });
    getSystemSettingsMock.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB);

    const { getCachedSystemSettings, invalidateSystemSettingsCache } = await loadCache();

    expect(await getCachedSystemSettings()).toBe(settingsA);

    invalidateSystemSettingsCache();
    expect(loggerInfoMock).toHaveBeenCalledWith("[SystemSettingsCache] Cache invalidated");
    await vi.waitFor(() =>
      expect(pubsubHarness.publish).toHaveBeenCalledWith("cch:cache:system_settings:updated")
    );

    expect(await getCachedSystemSettings()).toBe(settingsB);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  test("其他进程广播更新后应清空本地系统设置缓存", async () => {
    const settingsA = createSettings({ id: 411, billingModelSource: "original" });
    const settingsB = createSettings({ id: 412, billingModelSource: "redirected" });
    getSystemSettingsMock.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB);

    const { getCachedSystemSettings, ensureSystemSettingsCacheSubscription } = await loadCache();
    await ensureSystemSettingsCacheSubscription();

    expect(await getCachedSystemSettings()).toBe(settingsA);
    expect(await getCachedSystemSettings()).toBe(settingsA);
    pubsubHarness.callback?.("updated");

    expect(await getCachedSystemSettings()).toBe(settingsB);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  test("失效事件后不得让较早发出的查询重新缓存旧设置", async () => {
    const oldSettings = createSettings({ id: 421, billHedgeLosers: true });
    const newSettings = createSettings({ id: 422, billHedgeLosers: false });
    let resolveOldQuery: ((settings: SystemSettings) => void) | undefined;
    getSystemSettingsMock
      .mockImplementationOnce(
        () =>
          new Promise<SystemSettings>((resolve) => {
            resolveOldQuery = resolve;
          })
      )
      .mockResolvedValueOnce(newSettings);

    const { getCachedSystemSettings, ensureSystemSettingsCacheSubscription } = await loadCache();
    await ensureSystemSettingsCacheSubscription();

    const oldResult = getCachedSystemSettings();
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(1);
    pubsubHarness.callback?.("updated");
    resolveOldQuery?.(oldSettings);
    expect(await oldResult).toBe(oldSettings);

    expect(await getCachedSystemSettings()).toBe(newSettings);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(2);
  });

  test("isHttp2Enabled 应读取缓存并返回 enableHttp2", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(createSettings({ id: 501, enableHttp2: true }));
    const { isHttp2Enabled } = await loadCache();

    expect(await isHttp2Enabled()).toBe(true);
  });

  test.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("ENABLE_OPENAI_RESPONSES_WEBSOCKET=%s 应覆盖数据库设置", async (value, expected) => {
    process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET = value;
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ enableOpenaiResponsesWebsocket: !expected })
    );
    const { isOpenaiResponsesWebsocketEnabled } = await loadCache();

    expect(await isOpenaiResponsesWebsocketEnabled()).toBe(expected);
    expect(getSystemSettingsMock).not.toHaveBeenCalled();
  });

  test("未设置 ENABLE_OPENAI_RESPONSES_WEBSOCKET 时应读取数据库设置", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ enableOpenaiResponsesWebsocket: false })
    );
    const { isOpenaiResponsesWebsocketEnabled } = await loadCache();

    expect(await isOpenaiResponsesWebsocketEnabled()).toBe(false);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(1);
  });

  test("ENABLE_OPENAI_RESPONSES_WEBSOCKET 非法时应仅警告一次并回退数据库设置", async () => {
    process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET = " false ";
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ enableOpenaiResponsesWebsocket: true })
    );
    const { isOpenaiResponsesWebsocketEnabled } = await loadCache();

    expect(await isOpenaiResponsesWebsocketEnabled()).toBe(true);
    expect(await isOpenaiResponsesWebsocketEnabled()).toBe(true);
    expect(getSystemSettingsMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[SystemSettingsCache] Invalid ENABLE_OPENAI_RESPONSES_WEBSOCKET, using database setting",
      { value: " false " }
    );
  });
});
