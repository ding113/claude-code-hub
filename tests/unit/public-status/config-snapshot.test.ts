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
  readPublicStatusSiteMetadata(input: {
    redis: {
      status: string;
      get: (key: string) => Promise<string | null>;
    };
  }): Promise<{ siteTitle: string; siteDescription: string } | null>;
  publishCurrentPublicStatusConfigPointers(input: {
    configVersion: string;
    redis: {
      set: (key: string, value: string) => Promise<unknown>;
      eval: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
    };
  }): Promise<boolean>;
  readPublicStatusTimeZone(input: {
    redis: {
      status: string;
      get: (key: string) => Promise<string | null>;
    };
  }): Promise<string | null>;
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
    expect(JSON.stringify(snapshot)).not.toContain("sourceGroupName");
  });

  it("reads site metadata from the redis config projection", async () => {
    const mod = await importPublicStatusModule<ConfigSnapshotModule>(
      "@/lib/public-status/config-snapshot"
    );

    const redis = {
      status: "ready",
      get: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ key: "public-status:v1:config:cfg-2" }))
        .mockResolvedValueOnce(
          JSON.stringify({
            configVersion: "cfg-2",
            siteTitle: "Claude Code Hub Status",
            siteDescription: "Request-derived public status",
          })
        ),
    };

    await expect(mod.readPublicStatusSiteMetadata({ redis })).resolves.toEqual({
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
    });
  });

  it("returns null on malformed pointer records instead of throwing", async () => {
    const mod = await importPublicStatusModule<ConfigSnapshotModule>(
      "@/lib/public-status/config-snapshot"
    );

    const redis = {
      status: "ready",
      get: vi.fn().mockResolvedValueOnce("{broken-json"),
    };

    await expect(mod.readPublicStatusSiteMetadata({ redis })).resolves.toBeNull();
  });

  it("does not let an older configVersion overwrite the current pointer", async () => {
    const mod = await importPublicStatusModule<ConfigSnapshotModule>(
      "@/lib/public-status/config-snapshot"
    );

    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockResolvedValue(0),
    };

    await expect(
      mod.publishCurrentPublicStatusConfigPointers({
        configVersion: "cfg-1",
        redis,
      })
    ).resolves.toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
