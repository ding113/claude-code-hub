import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

const getSessionMock = vi.fn();
const updateSystemSettingsMock = vi.fn();
const getSystemSettingsRepoMock = vi.fn();
const revalidatePathMock = vi.fn();
const invalidateSystemSettingsCacheMock = vi.fn();
const loggerMock = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));
vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: () => invalidateSystemSettingsCacheMock(),
}));
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
  isValidIANATimezone: vi.fn(() => true),
}));
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsRepoMock(),
  updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
}));

function createSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  const base = {
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
  } satisfies SystemSettings;

  return { ...base, ...overrides };
}

describe("system settings responses websocket toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T00:00:00.000Z"));
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps enableResponsesWebSocket on the typed SystemSettings surface", () => {
    const settings = createSettings({ enableResponsesWebSocket: true });

    expect(settings.enableResponsesWebSocket).toBe(true);
  });

  it("forwards enableResponsesWebSocket through saveSystemSettings", async () => {
    updateSystemSettingsMock.mockResolvedValue(createSettings({ enableResponsesWebSocket: true }));
    const { saveSystemSettings } = await import("@/actions/system-config");

    const result = await saveSystemSettings({ enableResponsesWebSocket: true });

    expect(result.ok).toBe(true);
    expect(updateSystemSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enableResponsesWebSocket: true })
    );
    expect(invalidateSystemSettingsCacheMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached helper after invalidation within the same cycle", async () => {
    getSystemSettingsRepoMock
      .mockResolvedValueOnce(createSettings({ id: 1, enableResponsesWebSocket: false }))
      .mockResolvedValueOnce(createSettings({ id: 2, enableResponsesWebSocket: true }));

    const cacheModule = await import("@/lib/config/system-settings-cache");

    const first = await cacheModule.getCachedSystemSettings();
    expect(first.enableResponsesWebSocket).toBe(false);

    cacheModule.invalidateSystemSettingsCache();

    const second = await cacheModule.getCachedSystemSettings();
    expect(second.enableResponsesWebSocket).toBe(true);
    expect(await cacheModule.isResponsesWebSocketEnabled()).toBe(true);
    expect(getSystemSettingsRepoMock).toHaveBeenCalledTimes(2);
  });
});
