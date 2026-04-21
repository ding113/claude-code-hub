import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface ConfigSnapshotModule {
  buildPublicStatusConfigSnapshot(input: {
    configVersion: string;
    siteTitle: string;
    siteDescription: string;
    defaultIntervalMinutes: number;
    defaultRangeHours: number;
    groups: Array<{
      slug: string;
      displayName: string;
      sortOrder: number;
      description: string | null;
      models: Array<{
        publicModelKey: string;
        label: string;
        vendorIconKey: string;
        requestTypeBadge: string;
        internalProviderName?: string;
        endpointUrl?: string;
      }>;
    }>;
  }): {
    configVersion: string;
    siteTitle: string;
    siteDescription: string;
    groups: Array<{
      slug: string;
      displayName: string;
      models: Array<{
        publicModelKey: string;
        label: string;
        vendorIconKey: string;
        requestTypeBadge: string;
      }>;
    }>;
  };
}

describe("public-status config snapshot", () => {
  it("publishes a public-safe snapshot with resolved model metadata", async () => {
    const mod = await importPublicStatusModule<ConfigSnapshotModule>(
      "@/lib/public-status/config-snapshot"
    );

    const snapshot = mod.buildPublicStatusConfigSnapshot({
      configVersion: "cfg-2",
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          slug: "openai",
          displayName: "OpenAI",
          sortOrder: 10,
          description: "Primary public models",
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "chat",
              internalProviderName: "openai-prod-primary",
              endpointUrl: "https://internal.example/v1",
            },
          ],
        },
      ],
    });

    expect(snapshot).toMatchObject({
      configVersion: "cfg-2",
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
      groups: [
        {
          slug: "openai",
          displayName: "OpenAI",
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "chat",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("internalProviderName");
    expect(JSON.stringify(snapshot)).not.toContain("endpointUrl");
  });
});
