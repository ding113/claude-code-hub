import { describe, expect, it, vi } from "vitest";

const mockBootstrapProviderGroupsFromProviders = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/provider-groups/bootstrap", () => ({
  bootstrapProviderGroupsFromProviders: mockBootstrapProviderGroupsFromProviders,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

describe("status-page loader", () => {
  it("bootstraps provider groups before hydrating structured public models", async () => {
    mockGetSystemSettings.mockResolvedValue({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    mockBootstrapProviderGroupsFromProviders.mockResolvedValue({
      groups: [
        {
          id: 1,
          name: "openai",
          description: JSON.stringify({
            version: 2,
            publicStatus: {
              displayName: "OpenAI",
              publicGroupSlug: "openai",
              publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
            },
          }),
        },
      ],
      groupCounts: new Map(),
    });

    const mod = await import("@/app/[locale]/settings/status-page/loader");
    const result = await mod.loadStatusPageSettings();

    expect(mockBootstrapProviderGroupsFromProviders).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      initialWindowHours: 24,
      initialAggregationIntervalMinutes: 5,
      initialGroups: [
        {
          groupName: "openai",
          enabled: true,
          displayName: "OpenAI",
          publicGroupSlug: "openai",
          explanatoryCopy: "",
          sortOrder: 0,
          publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
        },
      ],
    });
  });
});
