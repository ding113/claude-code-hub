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

const DEFAULT_FAKE_STREAMING_MODELS = [
  { model: "gpt-image-2", groupTags: [] },
  { model: "gpt-image-1.5", groupTags: [] },
  { model: "gemini-3.1-flash-image-preview", groupTags: [] },
  { model: "gemini-3-pro-image-preview", groupTags: [] },
];

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
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    allowNonConversationEndpointProviderFallback: true,
    fakeStreamingWhitelist: DEFAULT_FAKE_STREAMING_MODELS,
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

describe("fake streaming whitelist system setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    updateSystemSettingsMock.mockResolvedValue(createSettings());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("transformer defaults", () => {
    test("defaults missing fake streaming config to requested image models", async () => {
      const { toSystemSettings } = await import("@/repository/_shared/transformers");

      const fromUndefined = toSystemSettings(undefined);
      expect(fromUndefined.fakeStreamingWhitelist).toEqual(DEFAULT_FAKE_STREAMING_MODELS);

      const fromNullField = toSystemSettings({
        id: 1,
        siteTitle: "Claude Code Hub",
        fakeStreamingWhitelist: null,
      });
      expect(fromNullField.fakeStreamingWhitelist).toEqual(DEFAULT_FAKE_STREAMING_MODELS);

      const fromMissingField = toSystemSettings({
        id: 1,
        siteTitle: "Claude Code Hub",
      });
      expect(fromMissingField.fakeStreamingWhitelist).toEqual(DEFAULT_FAKE_STREAMING_MODELS);
    });

    test("preserves empty fake streaming whitelist as explicit opt out", async () => {
      const { toSystemSettings } = await import("@/repository/_shared/transformers");

      const result = toSystemSettings({
        id: 1,
        siteTitle: "Claude Code Hub",
        fakeStreamingWhitelist: [],
      });

      expect(result.fakeStreamingWhitelist).toEqual([]);
    });

    test("preserves persisted non-empty fake streaming whitelist", async () => {
      const { toSystemSettings } = await import("@/repository/_shared/transformers");

      const persisted = [
        { model: "custom-model-a", groupTags: [] },
        { model: "custom-model-b", groupTags: ["group-a"] },
      ];

      const result = toSystemSettings({
        id: 1,
        siteTitle: "Claude Code Hub",
        fakeStreamingWhitelist: persisted,
      });

      expect(result.fakeStreamingWhitelist).toEqual(persisted);
    });

    test("repository fallback (table missing) defaults to image models", async () => {
      vi.resetModules();
      vi.doUnmock("@/repository/system-config");
      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn(() => {
            const query: Record<string, unknown> = {};
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
      expect(fallbackSettings.fakeStreamingWhitelist).toEqual(DEFAULT_FAKE_STREAMING_MODELS);

      // Restore the mock for subsequent tests in this file.
      vi.resetModules();
      vi.doMock("@/repository/system-config", () => ({
        getSystemSettings: () => getSystemSettingsMock(),
        updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
      }));
    });
  });

  describe("validation schema", () => {
    test("rejects duplicate fake streaming models", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      expect(() =>
        UpdateSystemSettingsSchema.parse({
          fakeStreamingWhitelist: [
            { model: "gpt-image-2", groupTags: [] },
            { model: "gpt-image-2", groupTags: ["group-a"] },
          ],
        })
      ).toThrow();
    });

    test("rejects duplicate models after trimming", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      expect(() =>
        UpdateSystemSettingsSchema.parse({
          fakeStreamingWhitelist: [
            { model: "gpt-image-2", groupTags: [] },
            { model: "  gpt-image-2  ", groupTags: [] },
          ],
        })
      ).toThrow();
    });

    test("trims model and groupTags entries", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const parsed = UpdateSystemSettingsSchema.parse({
        fakeStreamingWhitelist: [
          { model: "  gpt-image-2  ", groupTags: ["  group-a  ", " group-b "] },
        ],
      });

      expect(parsed.fakeStreamingWhitelist).toEqual([
        { model: "gpt-image-2", groupTags: ["group-a", "group-b"] },
      ]);
    });

    test("accepts empty groupTags as all-groups semantic", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const parsed = UpdateSystemSettingsSchema.parse({
        fakeStreamingWhitelist: [{ model: "gpt-image-2", groupTags: [] }],
      });

      expect(parsed.fakeStreamingWhitelist).toEqual([{ model: "gpt-image-2", groupTags: [] }]);
    });

    test("accepts empty whitelist (explicit disable)", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      const parsed = UpdateSystemSettingsSchema.parse({
        fakeStreamingWhitelist: [],
      });

      expect(parsed.fakeStreamingWhitelist).toEqual([]);
    });

    test("rejects empty model string", async () => {
      const { UpdateSystemSettingsSchema } = await import("@/lib/validation/schemas");

      expect(() =>
        UpdateSystemSettingsSchema.parse({
          fakeStreamingWhitelist: [{ model: "", groupTags: [] }],
        })
      ).toThrow();

      expect(() =>
        UpdateSystemSettingsSchema.parse({
          fakeStreamingWhitelist: [{ model: "   ", groupTags: [] }],
        })
      ).toThrow();
    });
  });

  describe("save action", () => {
    test("saves fake streaming whitelist entry for all groups and invalidates cache", async () => {
      const persisted = [
        { model: "gpt-image-2", groupTags: [] },
        { model: "gpt-image-1.5", groupTags: ["group-a", "group-b"] },
      ];

      updateSystemSettingsMock.mockResolvedValueOnce(
        createSettings({ fakeStreamingWhitelist: persisted })
      );

      const { saveSystemSettings } = await import("@/actions/system-config");
      const result = await saveSystemSettings({
        fakeStreamingWhitelist: persisted,
      });

      expect(result.ok).toBe(true);
      expect(updateSystemSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fakeStreamingWhitelist: persisted,
        })
      );
      expect(invalidateSystemSettingsCacheMock).toHaveBeenCalledTimes(1);
      if (result.ok) {
        expect(result.data.fakeStreamingWhitelist).toEqual(persisted);
      }
    });

    test("preserves empty fake streaming whitelist as explicit opt out", async () => {
      updateSystemSettingsMock.mockResolvedValueOnce(
        createSettings({ fakeStreamingWhitelist: [] })
      );

      const { saveSystemSettings } = await import("@/actions/system-config");
      const result = await saveSystemSettings({
        fakeStreamingWhitelist: [],
      });

      expect(result.ok).toBe(true);
      expect(updateSystemSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fakeStreamingWhitelist: [],
        })
      );
      if (result.ok) {
        expect(result.data.fakeStreamingWhitelist).toEqual([]);
      }
    });
  });
});
