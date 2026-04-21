import { describe, expect, it, vi } from "vitest";
import {
  createForbiddenCallSpy,
  createRedisClientSpy,
  importPublicStatusModule,
} from "../../helpers/public-status-test-helpers";

interface ReadStoreModule {
  readPublicStatusPayload(input: {
    intervalMinutes: number;
    rangeHours: number;
    nowIso: string;
    hasConfiguredGroups?: boolean;
    redis: ReturnType<typeof createRedisClientSpy>;
    triggerRebuildHint: (reason: string) => Promise<void> | void;
  }): Promise<{
    rebuildState: string;
    sourceGeneration: string;
  }>;
}

describe("public-status read store", () => {
  it("returns rebuilding when redis is unavailable", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:05:00.000Z",
      redis: null as never,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("redis-unavailable");
  });

  it("returns no-data when public status has no configured groups", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi.fn(),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:05:00.000Z",
      hasConfiguredGroups: false,
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("no-data");
    expect(triggerRebuildHint).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("returns rebuilding when manifest is missing", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:05:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("manifest-missing");
  });

  it("degrades to rebuilding when redis.get rejects", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi.fn().mockRejectedValueOnce(new Error("redis down")),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:05:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("manifest-missing");
  });

  it("returns rebuilding when snapshot is missing", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            generation: "gen-1",
            freshUntil: "2026-04-21T10:05:00.000Z",
            lastCompleteGeneration: "gen-1",
            rebuildState: "idle",
          })
        )
        .mockResolvedValueOnce(null),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("snapshot-missing");
  });

  it("serves current manifest as stale fallback when the requested config version is not ready", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          JSON.stringify({
            configVersion: "cfg-old",
            generation: "gen-old",
            freshUntil: "2026-04-21T10:05:00.000Z",
            lastCompleteGeneration: "gen-old",
            rebuildState: "idle",
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            sourceGeneration: "gen-old",
            generatedAt: "2026-04-21T10:00:00.000Z",
            freshUntil: "2026-04-21T10:05:00.000Z",
            groups: [],
          })
        ),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      configVersion: "cfg-new",
      nowIso: "2026-04-21T10:00:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("stale");
    expect(result.sourceGeneration).toBe("gen-old");
    expect(triggerRebuildHint).toHaveBeenCalledWith("config-version-mismatch");
  });

  it("treats malformed redis records as rebuilding instead of throwing", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi.fn().mockResolvedValueOnce("{not-json"),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("manifest-missing");
  });

  it("treats malformed snapshot payload as rebuilding instead of throwing", async () => {
    const triggerRebuildHint = vi.fn();
    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            generation: "gen-1",
            freshUntil: "2026-04-21T10:05:00.000Z",
            lastCompleteGeneration: "gen-1",
            rebuildState: "idle",
          })
        )
        .mockResolvedValueOnce("{broken-json"),
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("rebuilding");
    expect(triggerRebuildHint).toHaveBeenCalledWith("snapshot-missing");
  });

  it("serves stale data and requests a background rebuild without DB reads", async () => {
    const forbiddenDbRead = createForbiddenCallSpy("db-read");
    const forbiddenPriceLookup = createForbiddenCallSpy("findLatestPriceByModel");
    const triggerRebuildHint = vi.fn();

    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
      status: "ready",
      get: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            generation: "gen-1",
            freshUntil: "2026-04-21T10:00:00.000Z",
            lastCompleteGeneration: "gen-1",
            rebuildState: "idle",
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            generation: "gen-1",
            freshUntil: "2026-04-21T10:00:00.000Z",
            lastCompleteGeneration: "gen-1",
            rebuildState: "idle",
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            sourceGeneration: "gen-1",
            generatedAt: "2026-04-21T09:55:00.000Z",
            freshUntil: "2026-04-21T10:00:00.000Z",
          })
        ),
      dbRead: forbiddenDbRead,
      priceLookup: forbiddenPriceLookup,
    });

    const result = await mod.readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:05:00.000Z",
      redis,
      triggerRebuildHint,
    });

    expect(result.rebuildState).toBe("stale");
    expect(result.sourceGeneration).toBe("gen-1");
    expect(triggerRebuildHint).toHaveBeenCalledTimes(1);
    expect(forbiddenDbRead).not.toHaveBeenCalled();
    expect(forbiddenPriceLookup).not.toHaveBeenCalled();
  });
});
