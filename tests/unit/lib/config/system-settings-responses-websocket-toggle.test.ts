import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

// Mock dependencies before import
const getSystemSettingsMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: (...args: unknown[]) => getSystemSettingsMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: (...args: unknown[]) => loggerDebugMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: (...args: unknown[]) => loggerInfoMock(...args),
  },
}));

function createSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  const base: SystemSettings = {
    id: 1,
    siteTitle: "Claude Code Hub",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    enableResponsesWebSocket: false,
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
    isResponsesWebSocketEnabled: mod.isResponsesWebSocketEnabled,
    invalidateSystemSettingsCache: mod.invalidateSystemSettingsCache,
  };
}

describe("enableResponsesWebSocket toggle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("DEFAULT_SETTINGS includes enableResponsesWebSocket: false", async () => {
    // When DB fails and no cache exists, the fallback should include enableResponsesWebSocket: false
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await loadCache();

    const settings = await getCachedSystemSettings();
    expect(settings.enableResponsesWebSocket).toBe(false);
  });

  test("isResponsesWebSocketEnabled() returns the cached value when enabled", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ id: 100, enableResponsesWebSocket: true })
    );
    const { isResponsesWebSocketEnabled } = await loadCache();

    expect(await isResponsesWebSocketEnabled()).toBe(true);
  });

  test("isResponsesWebSocketEnabled() returns false when disabled", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ id: 101, enableResponsesWebSocket: false })
    );
    const { isResponsesWebSocketEnabled } = await loadCache();

    expect(await isResponsesWebSocketEnabled()).toBe(false);
  });

  test("transformer defaults to false when DB value is null/undefined", async () => {
    // Import transformer directly
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    // null/undefined dbSettings
    const fromUndefined = toSystemSettings(undefined);
    expect(fromUndefined.enableResponsesWebSocket).toBe(false);

    // DB row with enableResponsesWebSocket missing (null)
    const fromNull = toSystemSettings({ id: 1, enableResponsesWebSocket: null });
    expect(fromNull.enableResponsesWebSocket).toBe(false);

    // DB row with explicit false
    const fromFalse = toSystemSettings({ id: 2, enableResponsesWebSocket: false });
    expect(fromFalse.enableResponsesWebSocket).toBe(false);

    // DB row with explicit true
    const fromTrue = toSystemSettings({ id: 3, enableResponsesWebSocket: true });
    expect(fromTrue.enableResponsesWebSocket).toBe(true);
  });
});
