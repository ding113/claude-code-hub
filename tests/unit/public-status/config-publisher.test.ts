import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockFindAllProviderGroups = vi.hoisted(() => vi.fn());
const mockFindLatestPricesByModels = vi.hoisted(() => vi.fn());
const mockPublishInternalPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockPublishPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigPointers = vi.hoisted(() => vi.fn());
const mockGetRedisClient = vi.hoisted(() => vi.fn());

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: mockFindAllProviderGroups,
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPricesByModels: mockFindLatestPricesByModels,
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: mockGetRedisClient,
}));

vi.mock("@/lib/public-status/config-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-status/config-snapshot")>(
    "@/lib/public-status/config-snapshot"
  );

  return {
    ...actual,
    publishInternalPublicStatusConfigSnapshot: mockPublishInternalPublicStatusConfigSnapshot,
    publishPublicStatusConfigSnapshot: mockPublishPublicStatusConfigSnapshot,
    publishCurrentPublicStatusConfigPointers: mockPublishCurrentPublicStatusConfigPointers,
  };
});

describe("public-status config publisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSystemSettings.mockResolvedValue({
      siteTitle: "Claude Code Hub",
      timezone: "UTC",
      publicStatusAggregationIntervalMinutes: 5,
      publicStatusWindowHours: 24,
    });
    mockGetRedisClient.mockReturnValue({});
    mockPublishInternalPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-test",
      key: "internal",
      written: true,
    });
    mockPublishPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-test",
      key: "public",
      written: true,
    });
    mockPublishCurrentPublicStatusConfigPointers.mockResolvedValue(true);
    mockFindLatestPricesByModels.mockResolvedValue(new Map());
  });

  it("uses providerTypeOverride to resolve vendor icon and request type for ambiguous models", async () => {
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 1,
        name: "mixed",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "Mixed",
            publicModels: [
              {
                modelKey: "reasoner-pro",
                providerTypeOverride: "gemini",
              },
              {
                modelKey: "reasoner-pro-codex",
                providerTypeOverride: "codex",
              },
            ],
          },
        }),
      },
    ]);

    const mod = await import("@/lib/public-status/config-publisher");
    const result = await mod.publishCurrentPublicStatusConfigProjection({
      reason: "test",
      configVersion: "cfg-test",
    });

    expect(result.written).toBe(true);
    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          groups: [
            expect.objectContaining({
              models: [
                expect.objectContaining({
                  publicModelKey: "reasoner-pro",
                  vendorIconKey: "gemini",
                  requestTypeBadge: "gemini",
                }),
                expect.objectContaining({
                  publicModelKey: "reasoner-pro-codex",
                  vendorIconKey: "openai",
                  requestTypeBadge: "codex",
                }),
              ],
            }),
          ],
        }),
      })
    );
  });
});
