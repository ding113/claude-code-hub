import { describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
} from "@/lib/public-status/redis-contract";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";

function createRedisReader(entries: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => {
      const value = entries[key];
      return value == null ? null : JSON.stringify(value);
    }),
    status: "ready",
  };
}

describe("readPublicStatusPayload", () => {
  it("returns no-data immediately when no public groups are configured", async () => {
    const triggerRebuildHint = vi.fn();

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      hasConfiguredGroups: false,
      triggerRebuildHint,
    });

    expect(payload).toEqual({
      rebuildState: "no-data",
      sourceGeneration: "",
      generatedAt: null,
      freshUntil: null,
      groups: [],
    });
    expect(triggerRebuildHint).not.toHaveBeenCalled();
  });

  it("serves stale data from the current manifest when the versioned manifest is missing", async () => {
    const triggerRebuildHint = vi.fn();
    const redis = createRedisReader({
      [buildPublicStatusManifestKey({
        configVersion: "current",
        intervalMinutes: 5,
        rangeHours: 24,
      })]: {
        configVersion: "cfg-older",
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-stale",
        sourceGeneration: "gen-stale",
        coveredFrom: "2026-04-20T10:00:00.000Z",
        coveredTo: "2026-04-21T10:00:00.000Z",
        generatedAt: "2026-04-21T09:55:00.000Z",
        freshUntil: "2026-04-21T10:00:00.000Z",
        rebuildState: "idle",
        lastCompleteGeneration: "gen-stale",
      },
      [buildPublicStatusCurrentSnapshotKey({
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-stale",
      })]: {
        rebuildState: "fresh",
        sourceGeneration: "gen-stale",
        generatedAt: "2026-04-21T09:55:00.000Z",
        freshUntil: "2026-04-21T10:00:00.000Z",
        groups: [
          {
            publicGroupSlug: "openai",
            displayName: "OpenAI",
            explanatoryCopy: null,
            models: [],
          },
        ],
      },
    });

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:10:00.000Z",
      configVersion: "cfg-1",
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(payload).toMatchObject({
      rebuildState: "stale",
      sourceGeneration: "gen-stale",
      generatedAt: "2026-04-21T09:55:00.000Z",
      freshUntil: "2026-04-21T10:00:00.000Z",
    });
    expect(triggerRebuildHint).toHaveBeenCalledWith("stale-generation");
  });

  it("returns rebuilding when the manifest exists but the snapshot payload is missing", async () => {
    const triggerRebuildHint = vi.fn();
    const redis = createRedisReader({
      [buildPublicStatusManifestKey({
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
      })]: {
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-1",
        sourceGeneration: "gen-1",
        coveredFrom: "2026-04-20T10:00:00.000Z",
        coveredTo: "2026-04-21T10:00:00.000Z",
        generatedAt: "2026-04-21T09:59:00.000Z",
        freshUntil: "2026-04-21T10:04:00.000Z",
        rebuildState: "idle",
        lastCompleteGeneration: "gen-1",
      },
    });

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      configVersion: "cfg-1",
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(payload).toEqual({
      rebuildState: "rebuilding",
      sourceGeneration: "",
      generatedAt: null,
      freshUntil: null,
      groups: [],
    });
    expect(triggerRebuildHint).toHaveBeenCalledWith("snapshot-missing");
  });

  it("marks config-version drift as stale and strips unexpected fields from redis snapshots", async () => {
    const triggerRebuildHint = vi.fn();
    const redis = createRedisReader({
      [buildPublicStatusManifestKey({
        configVersion: "current",
        intervalMinutes: 5,
        rangeHours: 24,
      })]: {
        configVersion: "cfg-old",
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-stale",
        sourceGeneration: "gen-stale",
        coveredFrom: "2026-04-20T10:00:00.000Z",
        coveredTo: "2026-04-21T10:00:00.000Z",
        generatedAt: "2026-04-21T10:00:00.000Z",
        freshUntil: "2026-04-21T10:05:00.000Z",
        rebuildState: "idle",
        lastCompleteGeneration: "gen-stale",
      },
      [buildPublicStatusCurrentSnapshotKey({
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-stale",
      })]: {
        rebuildState: "fresh",
        sourceGeneration: "gen-stale",
        generatedAt: "2026-04-21T10:00:00.000Z",
        freshUntil: "2026-04-21T10:05:00.000Z",
        groups: [
          {
            publicGroupSlug: "openai",
            displayName: "OpenAI",
            explanatoryCopy: "Public projection only",
            sourceGroupName: "internal-openai",
            models: [
              {
                publicModelKey: "gpt-4.1",
                label: "GPT-4.1",
                vendorIconKey: "openai",
                requestTypeBadge: "openaiCompatible",
                latestState: "operational",
                availabilityPct: 99.5,
                latestTtfbMs: 120,
                latestTps: 4.2,
                endpointUrl: "https://internal.example.com",
                timeline: [
                  {
                    bucketStart: "2026-04-21T09:55:00.000Z",
                    bucketEnd: "2026-04-21T10:00:00.000Z",
                    state: "operational",
                    availabilityPct: 99.5,
                    ttfbMs: 120,
                    tps: 4.2,
                    sampleCount: 10,
                    providerFailures: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:01:00.000Z",
      configVersion: "cfg-new",
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(triggerRebuildHint.mock.calls.map(([reason]) => reason)).toEqual([
      "stale-generation",
      "config-version-mismatch",
    ]);
    expect(payload).toEqual({
      rebuildState: "stale",
      sourceGeneration: "gen-stale",
      generatedAt: "2026-04-21T10:00:00.000Z",
      freshUntil: "2026-04-21T10:05:00.000Z",
      groups: [
        {
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "Public projection only",
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
              latestState: "operational",
              availabilityPct: 99.5,
              latestTtfbMs: 120,
              latestTps: 4.2,
              timeline: [
                {
                  bucketStart: "2026-04-21T09:55:00.000Z",
                  bucketEnd: "2026-04-21T10:00:00.000Z",
                  state: "operational",
                  availabilityPct: 99.5,
                  ttfbMs: 120,
                  tps: 4.2,
                  sampleCount: 10,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("preserves degraded latestState and timeline states from redis snapshots", async () => {
    const triggerRebuildHint = vi.fn();
    const redis = createRedisReader({
      [buildPublicStatusManifestKey({
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
      })]: {
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-1",
        sourceGeneration: "gen-1",
        coveredFrom: "2026-04-20T10:00:00.000Z",
        coveredTo: "2026-04-21T10:00:00.000Z",
        generatedAt: "2026-04-21T09:59:00.000Z",
        freshUntil: "2026-04-21T10:04:00.000Z",
        rebuildState: "idle",
        lastCompleteGeneration: "gen-1",
      },
      [buildPublicStatusCurrentSnapshotKey({
        intervalMinutes: 5,
        rangeHours: 24,
        generation: "gen-1",
      })]: {
        sourceGeneration: "gen-1",
        generatedAt: "2026-04-21T09:59:00.000Z",
        freshUntil: "2026-04-21T10:04:00.000Z",
        groups: [
          {
            publicGroupSlug: "openai",
            displayName: "OpenAI",
            explanatoryCopy: null,
            models: [
              {
                publicModelKey: "gpt-4.1",
                label: "GPT-4.1",
                vendorIconKey: "openai",
                requestTypeBadge: "openaiCompatible",
                latestState: "degraded",
                availabilityPct: 92.5,
                latestTtfbMs: 180,
                latestTps: 3.1,
                timeline: [
                  {
                    bucketStart: "2026-04-21T09:55:00.000Z",
                    bucketEnd: "2026-04-21T10:00:00.000Z",
                    state: "degraded",
                    availabilityPct: 92.5,
                    ttfbMs: 180,
                    tps: 3.1,
                    sampleCount: 8,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 24,
      nowIso: "2026-04-21T10:00:00.000Z",
      configVersion: "cfg-1",
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(payload.groups[0]?.models[0]).toMatchObject({
      latestState: "degraded",
      timeline: [
        {
          bucketStart: "2026-04-21T09:55:00.000Z",
          bucketEnd: "2026-04-21T10:00:00.000Z",
          state: "degraded",
          availabilityPct: 92.5,
          ttfbMs: 180,
          tps: 3.1,
          sampleCount: 8,
        },
      ],
    });
  });

  it("drops timeline buckets with non-finite sampleCount values", async () => {
    const triggerRebuildHint = vi.fn();
    const manifestKey = buildPublicStatusManifestKey({
      configVersion: "cfg-1",
      intervalMinutes: 5,
      rangeHours: 24,
    });
    const snapshotKey = buildPublicStatusCurrentSnapshotKey({
      intervalMinutes: 5,
      rangeHours: 24,
      generation: "gen-1",
    });
    const redis = {
      get: vi.fn(async (key: string) => {
        if (key === manifestKey) {
          return "__manifest__";
        }
        if (key === snapshotKey) {
          return "__snapshot__";
        }
        return null;
      }),
      status: "ready",
    };
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((raw: string) => {
      if (raw === "__manifest__") {
        return {
          configVersion: "cfg-1",
          intervalMinutes: 5,
          rangeHours: 24,
          generation: "gen-1",
          sourceGeneration: "gen-1",
          coveredFrom: "2026-04-20T10:00:00.000Z",
          coveredTo: "2026-04-21T10:00:00.000Z",
          generatedAt: "2026-04-21T09:59:00.000Z",
          freshUntil: "2026-04-21T10:04:00.000Z",
          rebuildState: "idle",
          lastCompleteGeneration: "gen-1",
        };
      }

      if (raw === "__snapshot__") {
        return {
          sourceGeneration: "gen-1",
          generatedAt: "2026-04-21T09:59:00.000Z",
          freshUntil: "2026-04-21T10:04:00.000Z",
          groups: [
            {
              publicGroupSlug: "openai",
              displayName: "OpenAI",
              explanatoryCopy: null,
              models: [
                {
                  publicModelKey: "gpt-4.1",
                  label: "GPT-4.1",
                  vendorIconKey: "openai",
                  requestTypeBadge: "openaiCompatible",
                  latestState: "operational",
                  availabilityPct: 99.5,
                  latestTtfbMs: 120,
                  latestTps: 4.2,
                  timeline: [
                    {
                      bucketStart: "2026-04-21T09:45:00.000Z",
                      bucketEnd: "2026-04-21T09:50:00.000Z",
                      state: "operational",
                      availabilityPct: 99.1,
                      ttfbMs: 110,
                      tps: 4,
                      sampleCount: Number.NaN,
                    },
                    {
                      bucketStart: "2026-04-21T09:50:00.000Z",
                      bucketEnd: "2026-04-21T09:55:00.000Z",
                      state: "operational",
                      availabilityPct: 99.3,
                      ttfbMs: 115,
                      tps: 4.1,
                      sampleCount: Number.POSITIVE_INFINITY,
                    },
                    {
                      bucketStart: "2026-04-21T09:55:00.000Z",
                      bucketEnd: "2026-04-21T10:00:00.000Z",
                      state: "operational",
                      availabilityPct: 99.5,
                      ttfbMs: 120,
                      tps: 4.2,
                      sampleCount: 10,
                    },
                  ],
                },
              ],
            },
          ],
        };
      }

      throw new Error(`Unexpected JSON.parse input: ${raw}`);
    });

    try {
      const payload = await readPublicStatusPayload({
        intervalMinutes: 5,
        rangeHours: 24,
        nowIso: "2026-04-21T10:00:00.000Z",
        configVersion: "cfg-1",
        hasConfiguredGroups: true,
        redis,
        triggerRebuildHint,
      });

      expect(payload.groups[0]?.models[0]?.timeline).toEqual([
        {
          bucketStart: "2026-04-21T09:55:00.000Z",
          bucketEnd: "2026-04-21T10:00:00.000Z",
          state: "operational",
          availabilityPct: 99.5,
          ttfbMs: 120,
          tps: 4.2,
          sampleCount: 10,
        },
      ]);
    } finally {
      parseSpy.mockRestore();
    }
  });
});
