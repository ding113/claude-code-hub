import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockFindAllProviderGroups = vi.hoisted(() => vi.fn());
const mockFindLatestPricesByModels = vi.hoisted(() => vi.fn());
const mockPublishInternalPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockPublishPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigPointers = vi.hoisted(() => vi.fn());
const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
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
    readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
  };
});

describe("public-status config publisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSystemSettings.mockResolvedValue({
      siteTitle: "CC Hub",
      timezone: "UTC",
      publicStatusAggregationIntervalMinutes: 5,
      publicStatusWindowHours: 24,
    });
    mockGetRedisClient.mockReturnValue({});
    mockFindAllProviderGroups.mockResolvedValue([]);
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue(null);
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
          siteDescription: "CC Hub public status",
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
  }, 80_000);

  it("publishes the database title when the current snapshot is missing", async () => {
    const mod = await import("@/lib/public-status/config-publisher");

    const written = await mod.reconcilePublicStatusSiteTitleProjection();

    expect(written).toBe(true);
    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "startup-site-title-reconciliation",
        snapshot: expect.objectContaining({ siteTitle: "CC Hub" }),
      })
    );
  });

  it("skips Redis writes when the current snapshot title already matches", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-current",
      siteTitle: " CC Hub ",
    });
    const mod = await import("@/lib/public-status/config-publisher");

    const written = await mod.reconcilePublicStatusSiteTitleProjection();

    expect(written).toBe(true);
    expect(mockPublishInternalPublicStatusConfigSnapshot).not.toHaveBeenCalled();
    expect(mockPublishPublicStatusConfigSnapshot).not.toHaveBeenCalled();
    expect(mockPublishCurrentPublicStatusConfigPointers).not.toHaveBeenCalled();
  });

  it("reuses the current config version when replacing a stale title", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-current",
      siteTitle: "Claude Code Hub",
    });
    const mod = await import("@/lib/public-status/config-publisher");

    const written = await mod.reconcilePublicStatusSiteTitleProjection();

    expect(written).toBe(true);
    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "startup-site-title-reconciliation",
        snapshot: expect.objectContaining({ configVersion: "cfg-current", siteTitle: "CC Hub" }),
      })
    );
    expect(mockPublishCurrentPublicStatusConfigPointers).toHaveBeenCalledWith(
      expect.objectContaining({ configVersion: "cfg-current" })
    );
  });

  it("reports when a missing Redis projection cannot be written", async () => {
    mockPublishInternalPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-test",
      key: "internal",
      written: false,
    });
    const mod = await import("@/lib/public-status/config-publisher");

    const written = await mod.reconcilePublicStatusSiteTitleProjection();

    expect(written).toBe(false);
    expect(mockPublishCurrentPublicStatusConfigPointers).not.toHaveBeenCalled();
  });

  it("uses shared model-prefix matching for vendor icons without changing request type badges", async () => {
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 1,
        name: "mixed",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "Mixed",
            publicModels: [
              { modelKey: "qwen-max" },
              { modelKey: "deepseek-chat" },
              { modelKey: "qwen-plus", providerTypeOverride: "openai-compatible" },
            ],
          },
        }),
      },
    ]);

    const mod = await import("@/lib/public-status/config-publisher");
    await mod.publishCurrentPublicStatusConfigProjection({
      reason: "test",
      configVersion: "cfg-test",
    });

    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          groups: [
            expect.objectContaining({
              models: [
                expect.objectContaining({
                  publicModelKey: "qwen-max",
                  vendorIconKey: "qwen",
                  requestTypeBadge: "openaiCompatible",
                }),
                expect.objectContaining({
                  publicModelKey: "deepseek-chat",
                  vendorIconKey: "deepseek",
                  requestTypeBadge: "openaiCompatible",
                }),
                expect.objectContaining({
                  publicModelKey: "qwen-plus",
                  vendorIconKey: "qwen",
                  requestTypeBadge: "openaiCompatible",
                }),
              ],
            }),
          ],
        }),
      })
    );
  }, 40_000);

  it("uses model price metadata to derive public labels and vendor icons", async () => {
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 1,
        name: "openai",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "OpenAI",
            publicModels: [{ modelKey: "gpt-4.1" }],
          },
        }),
      },
    ]);
    mockFindLatestPricesByModels.mockResolvedValue(
      new Map([
        [
          "gpt-4.1",
          {
            priceData: {
              display_name: "GPT-4.1 Turbo",
              litellm_provider: "openai",
            },
          },
        ],
      ])
    );

    const mod = await import("@/lib/public-status/config-publisher");
    await mod.publishCurrentPublicStatusConfigProjection({
      reason: "test",
      configVersion: "cfg-test",
    });

    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          groups: [
            expect.objectContaining({
              models: [
                expect.objectContaining({
                  publicModelKey: "gpt-4.1",
                  label: "GPT-4.1 Turbo",
                  vendorIconKey: "openai",
                  requestTypeBadge: "openaiCompatible",
                }),
              ],
            }),
          ],
        }),
      })
    );
  }, 40_000);

  it("publishes internal snapshot sourceGroupName for default group while public snapshot keeps custom slug", async () => {
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 2,
        name: "default",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "Platform",
            publicGroupSlug: "platform",
            explanatoryCopy: "Default group status",
            sortOrder: 2,
            publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "openai-compatible" }],
          },
        }),
      },
    ]);

    const mod = await import("@/lib/public-status/config-publisher");
    await mod.publishCurrentPublicStatusConfigProjection({
      reason: "test",
      configVersion: "cfg-test",
    });

    expect(mockPublishInternalPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          groups: [
            expect.objectContaining({
              sourceGroupId: 2,
              sourceGroupName: "default",
              slug: "platform",
              displayName: "Platform",
            }),
          ],
        }),
      })
    );
    expect(mockPublishPublicStatusConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          groups: [
            expect.objectContaining({
              slug: "platform",
              displayName: "Platform",
            }),
          ],
        }),
      })
    );
  }, 40_000);

  it("publishes a Redis config projection when stored legacy group slugs collide", async () => {
    mockFindAllProviderGroups.mockResolvedValue([
      {
        id: 10,
        name: "cc特价",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "CC Special",
            publicGroupSlug: "cc",
            publicModels: [{ modelKey: "gpt-4.1" }],
          },
        }),
      },
      {
        id: 11,
        name: "cc逆向",
        description: JSON.stringify({
          version: 2,
          publicStatus: {
            displayName: "CC Reverse",
            publicGroupSlug: "cc",
            publicModels: [{ modelKey: "gpt-4.1" }],
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
          groups: expect.arrayContaining([
            expect.objectContaining({ slug: "cc", displayName: "CC Special" }),
            expect.objectContaining({
              slug: expect.stringMatching(/^cc-[a-z0-9]{6}$/),
              displayName: "CC Reverse",
            }),
          ]),
        }),
      })
    );
  }, 40_000);
});
