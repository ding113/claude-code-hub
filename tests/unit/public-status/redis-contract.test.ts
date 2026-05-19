import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface RedisContractModule {
  PUBLIC_STATUS_REDIS_PREFIX: string;
  LEGACY_PUBLIC_STATUS_REDIS_PREFIX: string;
  PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES: number;
  buildGenerationFingerprint(input: {
    configVersion: string;
    intervalMinutes: number;
    coveredFromIso: string;
    coveredToIso: string;
  }): string;
  alignBucketStartUtc(isoTimestamp: string, intervalMinutes: number): string;
  resolvePublicStatusManifestState(
    manifest: {
      freshUntil: string;
      lastCompleteGeneration: string | null;
      rebuildState: "idle" | "rebuilding";
    } | null,
    nowIso: string
  ): { rebuildState: string; sourceGeneration: string | null };
  buildPublicStatusManifestKey(input: {
    configVersion: string;
    intervalMinutes: number;
    rangeHours: number;
    prefix?: string;
  }): string;
  buildPublicStatusRollupKey(input: {
    bucketStartIso: string;
    bucketMinutes?: number;
    prefix?: string;
  }): string;
  buildPublicStatusRollupCoverageStartKey(input?: {
    bucketMinutes?: number;
    prefix?: string;
  }): string;
}

describe("public-status redis contract", () => {
  it("uses v2 keys by default while keeping explicit v1 builders for upgrade fallback", async () => {
    const mod = await importPublicStatusModule<RedisContractModule>(
      "@/lib/public-status/redis-contract"
    );

    expect(mod.PUBLIC_STATUS_REDIS_PREFIX).toBe("public-status:v2");
    expect(mod.LEGACY_PUBLIC_STATUS_REDIS_PREFIX).toBe("public-status:v1");
    expect(
      mod.buildPublicStatusManifestKey({
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
      })
    ).toBe("public-status:v2:manifest:cfg-1:5m:24h");
    expect(
      mod.buildPublicStatusManifestKey({
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
        prefix: mod.LEGACY_PUBLIC_STATUS_REDIS_PREFIX,
      })
    ).toBe("public-status:v1:manifest:cfg-1:5m:24h");
  });

  it("builds one aligned 5m rollup key per base bucket", async () => {
    const mod = await importPublicStatusModule<RedisContractModule>(
      "@/lib/public-status/redis-contract"
    );

    expect(mod.PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES).toBe(5);
    expect(
      mod.buildPublicStatusRollupKey({
        bucketStartIso: "2026-04-21T10:07:31.000Z",
      })
    ).toBe("public-status:v2:rollup:5m:2026-04-21T10%3A05%3A00.000Z");
    expect(mod.buildPublicStatusRollupCoverageStartKey()).toBe(
      "public-status:v2:rollup:coverage-start:5m"
    );
  });

  it("changes generation fingerprint when interval changes", async () => {
    const mod = await importPublicStatusModule<RedisContractModule>(
      "@/lib/public-status/redis-contract"
    );

    const input = {
      configVersion: "cfg-2026-04-21",
      coveredFromIso: "2026-04-20T00:00:00.000Z",
      coveredToIso: "2026-04-21T00:00:00.000Z",
    };

    const fiveMinute = mod.buildGenerationFingerprint({
      ...input,
      intervalMinutes: 5,
    });
    const fifteenMinute = mod.buildGenerationFingerprint({
      ...input,
      intervalMinutes: 15,
    });

    expect(fiveMinute).not.toBe(fifteenMinute);
  });

  it("aligns buckets on UTC interval boundaries", async () => {
    const mod = await importPublicStatusModule<RedisContractModule>(
      "@/lib/public-status/redis-contract"
    );

    expect(mod.alignBucketStartUtc("2026-04-21T10:07:31.000Z", 5)).toBe("2026-04-21T10:05:00.000Z");
    expect(mod.alignBucketStartUtc("2026-04-21T10:07:31.000Z", 15)).toBe(
      "2026-04-21T10:00:00.000Z"
    );
  });

  it("resolves manifest runtime states honestly", async () => {
    const mod = await importPublicStatusModule<RedisContractModule>(
      "@/lib/public-status/redis-contract"
    );

    expect(mod.resolvePublicStatusManifestState(null, "2026-04-21T10:00:00.000Z")).toMatchObject({
      rebuildState: "no-data",
      sourceGeneration: null,
    });

    expect(
      mod.resolvePublicStatusManifestState(
        {
          freshUntil: "2026-04-21T10:05:00.000Z",
          lastCompleteGeneration: null,
          rebuildState: "rebuilding",
        },
        "2026-04-21T10:00:00.000Z"
      )
    ).toMatchObject({
      rebuildState: "rebuilding",
      sourceGeneration: null,
    });

    expect(
      mod.resolvePublicStatusManifestState(
        {
          freshUntil: "2026-04-21T10:05:00.000Z",
          lastCompleteGeneration: "gen-1",
          rebuildState: "idle",
        },
        "2026-04-21T10:00:00.000Z"
      )
    ).toMatchObject({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
    });

    expect(
      mod.resolvePublicStatusManifestState(
        {
          freshUntil: "2026-04-21T10:05:00.000Z",
          lastCompleteGeneration: "gen-1",
          rebuildState: "idle",
        },
        "2026-04-21T10:10:00.000Z"
      )
    ).toMatchObject({
      rebuildState: "stale",
      sourceGeneration: "gen-1",
    });
  });
});
