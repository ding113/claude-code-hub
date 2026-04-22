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
});
