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
  readCurrentInternalPublicStatusConfigSnapshot(input: {
    redis: {
      status: string;
      get: (key: string) => Promise<string | null>;
    };
    allowLegacyFallback?: boolean;
  }): Promise<{
    configVersion: string;
    groups: unknown[];
  } | null>;
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

  it("can disable legacy config fallback for v2 rollup writers", async () => {
    const mod = await importPublicStatusModule<ConfigSnapshotModule>(
      "@/lib/public-status/config-snapshot"
    );

    const redis = {
      status: "ready",
      get: vi.fn(async (key: string) => {
        if (key === "public-status:v1:config-version:current") {
          return "cfg-v1";
        }
        if (key === "public-status:v1:config-internal:cfg-v1") {
          return JSON.stringify({
            configVersion: "cfg-v1",
            siteTitle: "Legacy",
            siteDescription: "Legacy",
            defaultIntervalMinutes: 5,
            defaultRangeHours: 24,
            groups: [],
          });
        }
        return null;
      }),
    };

    await expect(
      mod.readCurrentInternalPublicStatusConfigSnapshot({
        redis,
        allowLegacyFallback: false,
      })
    ).resolves.toBeNull();
    expect(redis.get).not.toHaveBeenCalledWith("public-status:v1:config-version:current");

    await expect(
      mod.readCurrentInternalPublicStatusConfigSnapshot({
        redis,
      })
    ).resolves.toMatchObject({ configVersion: "cfg-v1" });
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
  describe("Redis TTL strategy: only versioned snapshot keys get a TTL", () => {
    // Versioned keys (`public-status:v1:config:<version>` and the internal
    // variant) accumulate forever as configs are republished and MUST expire.
    // The three "current pointer" keys are overwritten on every publish, so
    // they MUST NOT carry a TTL — otherwise an idle deployment that goes
    // longer than the TTL without a config change would lose its pointer and
    // the public status page would silently go dark.

    it("publishPublicStatusConfigSnapshot TTLs the versioned key but leaves the pointer untouched", async () => {
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
      // First call: versioned key — MUST have EX TTL.
      const [versionedKey, , versionedMode, versionedTtl] = redis.set.mock.calls[0];
      expect(versionedKey).toMatch(/:config:cfg-2$/);
      expect(versionedMode).toBe("EX");
      expect(versionedTtl).toBe(ttl);
      // Second call: current pointer key — MUST be bare set with no TTL.
      const pointerCall = redis.set.mock.calls[1];
      expect(pointerCall).toHaveLength(2);
      expect(pointerCall[0]).toMatch(/:config:current$/);
    });

    it("publishInternalPublicStatusConfigSnapshot TTLs the versioned key but leaves the pointer untouched", async () => {
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
      const [versionedKey, , versionedMode, versionedTtl] = redis.set.mock.calls[0];
      expect(versionedKey).toMatch(/:config-internal:cfg-3$/);
      expect(versionedMode).toBe("EX");
      expect(versionedTtl).toBe(ttl);
      const pointerCall = redis.set.mock.calls[1];
      expect(pointerCall).toHaveLength(2);
      expect(pointerCall[0]).toMatch(/:config-internal:current$/);
    });

    it("publishCurrentPublicStatusConfigPointers (eval path) writes the pointer without TTL", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );

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
      // Pointer Lua MUST NOT apply an EX TTL — see TTL strategy above.
      expect(luaScript).not.toMatch(/EX/);
      // ARGV: [configVersion] only.
      expect(evalArgs[3]).toBe("cfg-99");
      expect(evalArgs[4]).toBeUndefined();
    });

    it("publishCurrentPublicStatusConfigPointers (non-eval fallback) writes the pointer without TTL", async () => {
      const mod = await importPublicStatusModule<ConfigSnapshotModule>(
        "@/lib/public-status/config-snapshot"
      );

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
      // Bare two-arg set — no EX, no TTL.
      expect(setArgs).toHaveLength(2);
      expect(setArgs[1]).toBe("cfg-100");
    });
  });
});
