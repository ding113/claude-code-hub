import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
} from "@/lib/public-status/redis-contract";

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());
const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockQueryPublicStatusRequests = vi.hoisted(() => vi.fn());
const mockBuildPublicStatusPayloadFromRequests = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({
    get: vi.fn(),
    set: mockRedisSet,
    del: mockRedisDel,
    status: "ready",
  }),
}));

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
}));

vi.mock("@/lib/public-status/aggregation", () => ({
  getConfiguredPublicStatusGroups: (snapshot: { groups: unknown[] }) => snapshot.groups,
  queryPublicStatusRequests: mockQueryPublicStatusRequests,
  buildPublicStatusPayloadFromRequests: mockBuildPublicStatusPayloadFromRequests,
}));

describe("public-status rebuild worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses concurrent rebuild requests into a single in-flight computation", async () => {
    const mod = await import("@/lib/public-status/rebuild-worker");

    let releaseCompute: (() => void) | undefined;
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve;
    });
    const computeGeneration = vi.fn(async () => {
      await computeGate;
      return { sourceGeneration: "generation-1" };
    });

    const first = mod.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });
    const second = mod.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });
    const third = mod.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });

    await Promise.resolve();
    expect(computeGeneration).toHaveBeenCalledTimes(1);

    releaseCompute?.();

    const results = await Promise.all([first, second, third]);

    expect(computeGeneration).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { sourceGeneration: "generation-1" },
      { sourceGeneration: "generation-1" },
      { sourceGeneration: "generation-1" },
    ]);
  });

  it("publishes snapshot and manifest records for a rebuilt generation", async () => {
    const mod = await import("@/lib/public-status/rebuild-worker");

    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      generatedAt: "2026-04-21T10:00:00.000Z",
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "Primary fleet",
          sortOrder: 1,
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
    });
    mockQueryPublicStatusRequests.mockResolvedValue([]);
    mockBuildPublicStatusPayloadFromRequests.mockReturnValue({
      generatedAt: "2026-04-21T10:00:00.000Z",
      coveredFrom: "2026-04-20T10:00:00.000Z",
      coveredTo: "2026-04-21T10:00:00.000Z",
      groups: [],
    });

    const result = await mod.rebuildPublicStatusProjection({
      intervalMinutes: 5,
      rangeHours: 24,
      now: new Date("2026-04-21T10:02:00.000Z"),
    });

    expect(result.status).toBe("updated");
    const currentManifestKey = buildPublicStatusManifestKey({
      configVersion: "current",
      intervalMinutes: 5,
      rangeHours: 24,
    });
    const snapshotSetCall = mockRedisSet.mock.calls.find((call) =>
      String(call[0]).includes("public-status:v1:snapshot:")
    );
    const manifestSetCall = mockRedisSet.mock.calls.find((call) => call[0] === currentManifestKey);

    expect(snapshotSetCall).toBeTruthy();
    expect(manifestSetCall).toBeTruthy();

    const manifestValue = JSON.parse(String(manifestSetCall?.[1]));
    expect(manifestValue.configVersion).toBe("cfg-1");
    expect(manifestValue.lastCompleteGeneration).toBeTruthy();

    const snapshotKey = buildPublicStatusCurrentSnapshotKey({
      intervalMinutes: 5,
      rangeHours: 24,
      generation: manifestValue.lastCompleteGeneration,
    });
    expect(mockRedisSet).toHaveBeenCalledWith(snapshotKey, expect.any(String));
  });
});
