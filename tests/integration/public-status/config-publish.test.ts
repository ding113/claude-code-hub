import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockUpdateSystemSettings = vi.hoisted(() => vi.fn());
const mockFindAllProviderGroups = vi.hoisted(() => vi.fn());
const mockUpdateProviderGroup = vi.hoisted(() => vi.fn());
const mockFindLatestPricesByModels = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigProjection = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());
const mockInvalidateSystemSettingsCache = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/system-config", () => ({
  updateSystemSettings: mockUpdateSystemSettings,
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: mockFindAllProviderGroups,
  updateProviderGroup: mockUpdateProviderGroup,
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPricesByModels: mockFindLatestPricesByModels,
}));

vi.mock("@/lib/public-status/config-publisher", () => ({
  publishCurrentPublicStatusConfigProjection: mockPublishCurrentPublicStatusConfigProjection,
}));

vi.mock("@/lib/public-status/rebuild-worker", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
}));

vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: mockInvalidateSystemSettingsCache,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
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
          publicModelKeys: ["gpt-4.1"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    expect(mockUpdateProviderGroup).toHaveBeenCalledTimes(1);
    expect(mockPublishCurrentPublicStatusConfigProjection).toHaveBeenCalledTimes(1);
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "config-updated",
    });
    expect(mockInvalidateSystemSettingsCache).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalled();
  });
});
