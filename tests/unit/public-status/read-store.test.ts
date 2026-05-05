import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
} from "@/lib/public-status/redis-contract";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";

const mockReadPublicStatusHourlyRollups = vi.hoisted(() => vi.fn());
const mockReadCurrentHourPublicStatusSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/hourly-rollups", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-status/hourly-rollups")>(
    "@/lib/public-status/hourly-rollups"
  );
  return {
    ...actual,
    readPublicStatusHourlyRollups: mockReadPublicStatusHourlyRollups,
    readCurrentHourPublicStatusSummary: mockReadCurrentHourPublicStatusSummary,
  };
});

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
  beforeEach(() => {
    mockReadPublicStatusHourlyRollups.mockResolvedValue([]);
    mockReadCurrentHourPublicStatusSummary.mockResolvedValue([]);
  });

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

  it("serves DB hourly rollups and merges current-hour Redis summary before legacy snapshot fallback", async () => {
    const triggerRebuildHint = vi.fn();
    const redis = createRedisReader({});
    mockReadPublicStatusHourlyRollups.mockResolvedValue([
      {
        bucketStart: new Date("2026-04-21T08:00:00.000Z"),
        bucketEnd: new Date("2026-04-21T09:00:00.000Z"),
        configVersion: "cfg-1",
        sourceGroupName: "openai",
        publicGroupSlug: "openai",
        publicModelKey: "gpt-4.1",
        label: "GPT-4.1",
        vendorIconKey: "openai",
        requestTypeBadge: "openaiCompatible",
        state: "operational",
        successCount: 9,
        failureCount: 1,
        sampleCount: 10,
        availabilityPct: 90,
        ttfbMs: 120,
        tps: 5,
        generatedAt: new Date("2026-04-21T09:00:00.000Z"),
      },
    ]);
    mockReadCurrentHourPublicStatusSummary.mockResolvedValue([
      {
        bucketStart: new Date("2026-04-21T10:00:00.000Z"),
        bucketEnd: new Date("2026-04-21T11:00:00.000Z"),
        configVersion: "cfg-1",
        sourceGroupName: "openai",
        publicGroupSlug: "openai",
        publicModelKey: "gpt-4.1",
        label: "GPT-4.1",
        vendorIconKey: "openai",
        requestTypeBadge: "openaiCompatible",
        state: "failed",
        successCount: 0,
        failureCount: 2,
        sampleCount: 2,
        availabilityPct: 0,
        ttfbMs: null,
        tps: null,
        generatedAt: new Date("2026-04-21T10:10:00.000Z"),
      },
    ]);

    const payload = await readPublicStatusPayload({
      intervalMinutes: 5,
      rangeHours: 3,
      nowIso: "2026-04-21T10:15:00.000Z",
      configVersion: "cfg-1",
      configSnapshot: {
        configVersion: "cfg-1",
        generatedAt: "2026-04-21T10:00:00.000Z",
        siteTitle: "Status",
        siteDescription: "Status",
        timeZone: null,
        defaultIntervalMinutes: 5,
        defaultRangeHours: 24,
        groups: [
          {
            slug: "openai",
            sourceGroupName: "openai",
            displayName: "OpenAI",
            sortOrder: 1,
            description: null,
            models: [
              {
                publicModelKey: "gpt-4.1",
                label: "GPT-4.1",
                vendorIconKey: "openai",
                requestTypeBadge: "openaiCompatible",
              },
            ],
          },
        ],
      },
      hasConfiguredGroups: true,
      redis,
      triggerRebuildHint,
    });

    expect(payload.rebuildState).toBe("fresh");
    expect(payload.groups[0]?.models[0]?.latestState).toBe("failed");
    expect(payload.groups[0]?.models[0]?.timeline).toHaveLength(3);
    expect(payload.groups[0]?.models[0]?.timeline[0]).toMatchObject({
      bucketStart: "2026-04-21T08:00:00.000Z",
      sampleCount: 10,
    });
    expect(payload.groups[0]?.models[0]?.timeline[2]).toMatchObject({
      bucketStart: "2026-04-21T10:00:00.000Z",
      sampleCount: 2,
      state: "failed",
    });
    expect(redis.get).not.toHaveBeenCalledWith(
      buildPublicStatusManifestKey({
        configVersion: "cfg-1",
        intervalMinutes: 5,
        rangeHours: 3,
      })
    );
    expect(mockReadPublicStatusHourlyRollups).toHaveBeenCalledWith({
      start: new Date("2026-04-21T08:00:00.000Z"),
      end: new Date("2026-04-21T10:00:00.000Z"),
      configVersion: "cfg-1",
    });
    expect(triggerRebuildHint).not.toHaveBeenCalled();
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
