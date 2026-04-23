import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockUpdateSystemSettings = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockFindAllProviderGroups = vi.hoisted(() => vi.fn());
const mockFindProviderGroupById = vi.hoisted(() => vi.fn());
const mockUpdateProviderGroup = vi.hoisted(() => vi.fn());
const mockFindLatestPricesByModels = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigProjection = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());
const mockInvalidateSystemSettingsCache = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() =>
  vi.fn(async (callback: (tx: object) => unknown) => callback({}))
);

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
  updateSystemSettings: mockUpdateSystemSettings,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: mockDbTransaction,
  },
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: mockFindAllProviderGroups,
  findProviderGroupById: mockFindProviderGroupById,
  updateProviderGroup: mockUpdateProviderGroup,
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPricesByModels: mockFindLatestPricesByModels,
}));

vi.mock("@/lib/public-status/config-publisher", () => ({
  publishCurrentPublicStatusConfigProjection: mockPublishCurrentPublicStatusConfigProjection,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
}));

vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: mockInvalidateSystemSettingsCache,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
  },
}));

describe("public-status config publish integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSession.mockResolvedValue({
      user: {
        id: 1,
        role: "admin",
      },
    });
    mockUpdateSystemSettings.mockResolvedValue({
      id: 1,
      siteTitle: "Claude Code Hub",
      timezone: "UTC",
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    mockGetSystemSettings.mockResolvedValue({
      id: 1,
      siteTitle: "Claude Code Hub",
      timezone: "UTC",
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 10,
        name: "openai",
        description: null,
      },
    ]);
    mockUpdateProviderGroup.mockResolvedValue(undefined);
    mockFindProviderGroupById.mockResolvedValue({
      id: 10,
      name: "openai",
      description: null,
    });
    mockFindLatestPricesByModels.mockResolvedValue(
      new Map([
        [
          "gpt-4.1",
          {
            modelName: "gpt-4.1",
            priceData: {
              display_name: "GPT-4.1",
              litellm_provider: "openai",
            },
          },
        ],
      ])
    );
    mockPublishCurrentPublicStatusConfigProjection.mockResolvedValue({
      configVersion: "cfg-1",
      key: "public-status:v1:config:cfg-1",
      written: true,
      groupCount: 1,
    });
    mockSchedulePublicStatusRebuild.mockResolvedValue({
      accepted: true,
      rebuildState: "rebuilding",
    });
    mockDbTransaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({}));
  });

  it("updates DB truth, republishes Redis snapshot, and queues rebuild metadata", async () => {
    const { savePublicStatusSettings } = await import("@/actions/public-status");

    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "openai",
          displayName: "OpenAI",
          publicGroupSlug: "openai",
          publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpdateSystemSettings).toHaveBeenCalledWith(
      {
        publicStatusWindowHours: 24,
        publicStatusAggregationIntervalMinutes: 5,
      },
      {}
    );
    expect(mockUpdateProviderGroup).toHaveBeenCalledTimes(1);
    expect(mockUpdateProviderGroup).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        description: expect.stringContaining('"providerTypeOverride":"codex"'),
      }),
      {}
    );
    expect(mockPublishCurrentPublicStatusConfigProjection).toHaveBeenCalledTimes(1);
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "config-updated",
    });
    expect(mockInvalidateSystemSettingsCache).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("republishes Redis snapshot and queues rebuild metadata for relevant system setting changes", async () => {
    const { saveSystemSettings } = await import("@/actions/system-config");

    const result = await saveSystemSettings({
      siteTitle: "Status Hub",
      timezone: "Asia/Shanghai",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        publicStatusProjectionWarningCode: null,
      },
    });
    expect(mockPublishCurrentPublicStatusConfigProjection).toHaveBeenCalledWith({
      reason: "save-system-settings",
    });
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "system-settings-updated",
    });
  });

  it("does not republish Redis snapshot for unrelated system setting changes", async () => {
    const { saveSystemSettings } = await import("@/actions/system-config");

    const result = await saveSystemSettings({
      verboseProviderError: true,
    });

    expect(result.ok).toBe(true);
    expect(mockPublishCurrentPublicStatusConfigProjection).not.toHaveBeenCalled();
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("returns success with a warning when DB truth is saved but Redis projection is unavailable", async () => {
    mockPublishCurrentPublicStatusConfigProjection.mockResolvedValue({
      configVersion: "cfg-2",
      key: "public-status:v1:config:cfg-2",
      written: false,
      groupCount: 1,
    });

    const { savePublicStatusSettings } = await import("@/actions/public-status");

    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "openai",
          displayName: "OpenAI",
          publicGroupSlug: "openai",
          publicModels: [{ modelKey: "gpt-4.1" }],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        publicStatusProjectionWarningCode: "PUBLIC_STATUS_PROJECTION_PUBLISH_FAILED",
      },
    });
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("rejects aggregation intervals outside the public allowlist", async () => {
    const { savePublicStatusSettings } = await import("@/actions/public-status");

    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 10,
      groups: [],
    });

    expect(result.ok).toBe(false);
    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
    expect(mockPublishCurrentPublicStatusConfigProjection).not.toHaveBeenCalled();
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized publicGroupSlug values before saving DB truth", async () => {
    const { savePublicStatusSettings } = await import("@/actions/public-status");

    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "openai-primary",
          displayName: "OpenAI Primary",
          publicGroupSlug: "Open AI",
          publicModels: [{ modelKey: "gpt-4.1" }],
        },
        {
          groupName: "openai-fallback",
          displayName: "OpenAI Fallback",
          publicGroupSlug: "open-ai",
          publicModels: [{ modelKey: "gpt-4.1" }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
    expect(mockPublishCurrentPublicStatusConfigProjection).not.toHaveBeenCalled();
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("keeps the last complete generation readable while the new config version is still rebuilding", async () => {
    const { buildPublicStatusCurrentSnapshotKey, buildPublicStatusManifestKey } = await import(
      "@/lib/public-status/redis-contract"
    );
    const { readPublicStatusPayload } = await import("@/lib/public-status/read-store");

    const redis = {
      get: vi.fn(async (key: string) => {
        const entries: Record<string, unknown> = {
          [buildPublicStatusManifestKey({
            configVersion: "current",
            intervalMinutes: 5,
            rangeHours: 24,
          })]: {
            configVersion: "cfg-older",
            intervalMinutes: 5,
            rangeHours: 24,
            generation: "gen-stale",
            sourceGeneration: "gen-stale",
            coveredFrom: "2026-04-20T10:00:00.000Z",
            coveredTo: "2026-04-21T10:00:00.000Z",
            generatedAt: "2026-04-21T09:55:00.000Z",
            freshUntil: "2026-04-21T10:00:00.000Z",
            rebuildState: "idle",
            lastCompleteGeneration: "gen-stale",
          },
          [buildPublicStatusCurrentSnapshotKey({
            intervalMinutes: 5,
            rangeHours: 24,
            generation: "gen-stale",
          })]: {
            rebuildState: "fresh",
            sourceGeneration: "gen-stale",
            generatedAt: "2026-04-21T09:55:00.000Z",
            freshUntil: "2026-04-21T10:00:00.000Z",
            groups: [],
          },
        };
        const value = entries[key];
        return value == null ? null : JSON.stringify(value);
      }),
      status: "ready",
    };
    const triggerRebuildHint = vi.fn();

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:10:00.000Z",
      configVersion: "cfg-newer",
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(payload).toMatchObject({
      rebuildState: "stale",
      sourceGeneration: "gen-stale",
      generatedAt: "2026-04-21T09:55:00.000Z",
    });
    expect(triggerRebuildHint).toHaveBeenCalledWith("stale-generation");
  });
});
