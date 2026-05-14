import { describe, expect, it, vi } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface ConfigSnapshotModule {
  PUBLIC_STATUS_CONFIG_TTL_SECONDS: number;
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
  publishPublicStatusConfigSnapshot(input: {
    reason: string;
    snapshot?: {
      configVersion: string;
      generatedAt: string;
      siteTitle: string;
      siteDescription: string;
      timeZone: string | null;
      defaultIntervalMinutes: number;
      defaultRangeHours: number;
      groups: unknown[];
    };
    redis: {
      set: (...args: unknown[]) => Promise<unknown>;
    };
    setCurrentPointer?: boolean;
  }): Promise<{ configVersion: string; key: string; written: boolean }>;
  publishInternalPublicStatusConfigSnapshot(input: {
    snapshot: {
      configVersion: string;
      generatedAt: string;
      siteTitle: string;
      siteDescription: string;
      timeZone: string | null;
      defaultIntervalMinutes: number;
      defaultRangeHours: number;
      groups: unknown[];
    };
    redis: {
      set: (...args: unknown[]) => Promise<unknown>;
    };
    setCurrentPointer?: boolean;
  }): Promise<{ configVersion: string; key: string; written: boolean }>;
  publishCurrentPublicStatusConfigPointers(input: {
    configVersion: string;
    redis: {
      set: (...args: unknown[]) => Promise<unknown>;
      eval?: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
    };
  }): Promise<boolean>;
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

  // Regression: before this guard, every config publish wrote Redis keys
  // without TTL, so versioned snapshot keys accumulated forever as
  // provider/group/system-settings changes minted new config versions.
  describe("Redis writes apply PUBLIC_STATUS_CONFIG_TTL_SECONDS", () => {
    it("publishPublicStatusConfigSnapshot writes both the versioned key and the current pointer with TTL", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );
      const ttl = mod.PUBLIC_STATUS_CONFIG_TTL_SECONDS;
      expect(ttl).toBeGreaterThan(0);

      const redis = { set: vi.fn().mockResolvedValue("OK") };

      await mod.publishPublicStatusConfigSnapshot({
        reason: "test",
        snapshot: {
          configVersion: "cfg-2",
          generatedAt: new Date().toISOString(),
          siteTitle: "Test",
          siteDescription: "Test",
          timeZone: null,
          defaultIntervalMinutes: 5,
          defaultRangeHours: 24,
          groups: [],
        },
        redis,
      });

      expect(redis.set).toHaveBeenCalledTimes(2);
      for (const call of redis.set.mock.calls) {
        expect(call[2]).toBe("EX");
        expect(call[3]).toBe(ttl);
      }
    });

    it("publishInternalPublicStatusConfigSnapshot writes both the versioned key and the current pointer with TTL", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );
      const ttl = mod.PUBLIC_STATUS_CONFIG_TTL_SECONDS;

      const redis = { set: vi.fn().mockResolvedValue("OK") };

      await mod.publishInternalPublicStatusConfigSnapshot({
        snapshot: {
          configVersion: "cfg-3",
          generatedAt: new Date().toISOString(),
          siteTitle: "Test",
          siteDescription: "Test",
          timeZone: null,
          defaultIntervalMinutes: 5,
          defaultRangeHours: 24,
          groups: [],
        },
        redis,
      });

      expect(redis.set).toHaveBeenCalledTimes(2);
      for (const call of redis.set.mock.calls) {
        expect(call[2]).toBe("EX");
        expect(call[3]).toBe(ttl);
      }
    });

    it("publishCurrentPublicStatusConfigPointers (eval path) passes the TTL through Lua ARGV", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );
      const ttl = mod.PUBLIC_STATUS_CONFIG_TTL_SECONDS;

      const evalMock = vi.fn().mockResolvedValue(1);
      const redis = {
        set: vi.fn().mockResolvedValue("OK"),
        eval: evalMock,
      };

      await expect(
        mod.publishCurrentPublicStatusConfigPointers({ configVersion: "cfg-99", redis })
      ).resolves.toBe(true);

      expect(evalMock).toHaveBeenCalledTimes(1);
      const evalArgs = evalMock.mock.calls[0];
      const luaScript = evalArgs[0] as string;
      // Lua MUST apply EX <ttl> atomically with the SET so the pointer
      // refreshes its expiration on every successful publish.
      expect(luaScript).toMatch(/SET.+'EX'.+ARGV\[2\]/);
      // ARGV: [configVersion, ttlSeconds] — both passed as strings.
      expect(evalArgs[3]).toBe("cfg-99");
      expect(evalArgs[4]).toBe(String(ttl));
    });

    it("publishCurrentPublicStatusConfigPointers (non-eval fallback) applies TTL on the bare set", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );
      const ttl = mod.PUBLIC_STATUS_CONFIG_TTL_SECONDS;

      const redis: {
        set: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
      } = {
        set: vi.fn().mockResolvedValue("OK"),
        get: vi.fn().mockResolvedValue(null),
      };

      await expect(
        mod.publishCurrentPublicStatusConfigPointers({ configVersion: "cfg-100", redis })
      ).resolves.toBe(true);

      expect(redis.set).toHaveBeenCalledTimes(1);
      const setArgs = redis.set.mock.calls[0];
      expect(setArgs[2]).toBe("EX");
      expect(setArgs[3]).toBe(ttl);
    });
  });
});
