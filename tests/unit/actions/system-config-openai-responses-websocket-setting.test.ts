import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getSystemSettingsMock = vi.fn();
const updateSystemSettingsMock = vi.fn();
const getSessionMock = vi.fn();
const invalidateSystemSettingsCacheMock = vi.fn();
const invalidateProviderSelectorSystemSettingsCacheMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
  updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
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

vi.mock("@/app/v1/_lib/proxy/provider-selector-settings-cache", () => ({
  invalidateProviderSelectorSystemSettingsCache: () =>
    invalidateProviderSelectorSystemSettingsCacheMock(),
}));

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

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
    passThroughUpstreamErrorMessage: true,
    enableHttp2: false,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableResponseInputRectifier: true,
    allowNonConversationEndpointProviderFallback: true,
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
    publicStatusWindowHours: 24,
    publicStatusAggregationIntervalMinutes: 5,
    ipExtractionConfig: null,
    ipGeoLookupEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
  getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  getSystemSettingsMock.mockResolvedValue(createSettings());
  updateSystemSettingsMock.mockResolvedValue(createSettings());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAI Responses WebSocket system setting", () => {
  test("repository transformer defaults the global setting to enabled", async () => {
    const { toSystemSettings } = await import("@/repository/_shared/transformers");

    const settings = toSystemSettings(undefined) as unknown as Record<string, unknown>;

    expect(settings.enableOpenAIResponsesWebSocket).toBe(true);
  });

  test("validation schema preserves explicit disabled value before persistence", async () => {
    const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

    const parsed = UpdateSystemSettingsSchema.parse({
      enableOpenAIResponsesWebSocket: false,
    }) as Record<string, unknown>;

    expect(parsed.enableOpenAIResponsesWebSocket).toBe(false);
  });

  test("save action persists the setting and invalidates system-settings caches", async () => {
    updateSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ enableOpenAIResponsesWebSocket: false })
    );
    const { saveSystemSettings } = await import("@/actions/system-config");

    const payload = {
      enableOpenAIResponsesWebSocket: false,
    } as Parameters<typeof saveSystemSettings>[0] & Record<string, unknown>;
    const result = await saveSystemSettings(payload);

    expect(result.ok).toBe(true);
    expect(invalidateSystemSettingsCacheMock).toHaveBeenCalledTimes(1);
    expect(invalidateProviderSelectorSystemSettingsCacheMock).toHaveBeenCalledTimes(1);
    expect(updateSystemSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enableOpenAIResponsesWebSocket: false,
      })
    );
  });

  test("cache cold fallback keeps the global WebSocket setting enabled", async () => {
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db down"));
    const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");

    const settings = (await getCachedSystemSettings()) as unknown as Record<string, unknown>;

    expect(settings.enableOpenAIResponsesWebSocket).toBe(true);
  });

  test("dedicated helper reads the cached WebSocket setting", async () => {
    getSystemSettingsMock.mockResolvedValueOnce(
      createSettings({ enableOpenAIResponsesWebSocket: false })
    );
    const cacheModule = (await import("@/lib/config/system-settings-cache")) as Record<
      string,
      unknown
    >;

    expect(cacheModule.isOpenAIResponsesWebSocketEnabled).toEqual(expect.any(Function));
    const isOpenAIResponsesWebSocketEnabled =
      cacheModule.isOpenAIResponsesWebSocketEnabled as () => Promise<boolean>;

    expect(await isOpenAIResponsesWebSocketEnabled()).toBe(false);
  });
});
