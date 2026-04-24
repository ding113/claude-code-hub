import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getSystemSettingsMock = vi.fn();
const loggerWarnMock = vi.fn();
const invalidateSystemSettingsCacheMock = vi.fn();
const updateSystemSettingsMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
  updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    invalidateSystemSettingsCache: () => invalidateSystemSettingsCacheMock(),
  };
});

vi.mock("@/lib/public-status/config-publisher", () => ({
  publishCurrentPublicStatusConfigProjection: vi.fn(async () => ({
    configVersion: "cfg-1",
    key: "public-status:v1:config:cfg-1",
    written: true,
    groupCount: 0,
  })),
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: vi.fn(async () => ({
    accepted: true,
    rebuildState: "rebuilding",
  })),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
  isValidIANATimezone: vi.fn(() => true),
}));

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    siteTitle: "Claude Code Hub",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    codexPriorityBillingSource: "requested",
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableResponseInputRectifier: true,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    allowNonConversationEndpointProviderFallback: true,
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
    publicStatusWindowHours: 24,
    publicStatusAggregationIntervalMinutes: 5,
    ipExtractionConfig: null,
    ipGeoLookupEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function loadCacheModule() {
  const mod = await import("@/lib/config/system-settings-cache");
  return {
    getCachedSystemSettings: mod.getCachedSystemSettings,
    invalidateSystemSettingsCache: mod.invalidateSystemSettingsCache,
  };
}

describe("non-chat fallback system setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    updateSystemSettingsMock.mockResolvedValue(createSettings());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("transformer/repository 保持启用默认值，但缓存层异常回退必须 fail-closed", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");
    expect(toSystemSettings(undefined).allowNonConversationEndpointProviderFallback).toBe(true);
    expect(
      toSystemSettings({
        id: 1,
        siteTitle: "Claude Code Hub",
      }).allowNonConversationEndpointProviderFallback
    ).toBe(true);

    vi.resetModules();
    vi.doUnmock("@/repository/system-config");
    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => {
          const query: any = {};
          query.from = vi.fn(() => query);
          query.orderBy = vi.fn(() => query);
          query.limit = vi.fn(() => Promise.reject({ code: "42P01" }));
          return query;
        }),
        update: vi.fn(),
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { getSystemSettings } = await import("@/repository/system-config");
    const fallbackSettings = await getSystemSettings();
    expect(fallbackSettings.allowNonConversationEndpointProviderFallback).toBe(true);

    vi.resetModules();
    vi.doMock("@/repository/system-config", () => ({
      getSystemSettings: () => getSystemSettingsMock(),
      updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
    }));
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await loadCacheModule();
    const cachedFallback = await getCachedSystemSettings();
    expect(cachedFallback.allowNonConversationEndpointProviderFallback).toBe(false);
  });

  test("persists update and invalidates cache", async () => {
    updateSystemSettingsMock.mockResolvedValueOnce(
      createSettings({
        allowNonConversationEndpointProviderFallback: false,
      })
    );

    const { saveSystemSettings } = await import("@/actions/system-config");
    const result = await saveSystemSettings({
      allowNonConversationEndpointProviderFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(updateSystemSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowNonConversationEndpointProviderFallback: false,
      })
    );
    expect(invalidateSystemSettingsCacheMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      data: {
        allowNonConversationEndpointProviderFallback: false,
      },
    });
  });
});
