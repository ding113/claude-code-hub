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
    redis: ReturnType<typeof createRedisClientSpy>;
    triggerRebuildHint: (reason: string) => Promise<void> | void;
  }): Promise<{
    rebuildState: string;
    sourceGeneration: string;
  }>;
}

describe("public-status read store", () => {
  it("serves stale data and requests a background rebuild without DB reads", async () => {
    const forbiddenDbRead = createForbiddenCallSpy("db-read");
    const forbiddenPriceLookup = createForbiddenCallSpy("findLatestPriceByModel");
    const triggerRebuildHint = vi.fn();

    const mod = await importPublicStatusModule<ReadStoreModule>("@/lib/public-status/read-store");

    const redis = createRedisClientSpy({
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
