import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
  buildPublicStatusRebuildHintKey,
} from "@/lib/public-status/redis-contract";

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());
const mockReadCurrentInternalPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
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
  readCurrentInternalPublicStatusConfigSnapshot: mockReadCurrentInternalPublicStatusConfigSnapshot,
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

    mockReadCurrentInternalPublicStatusConfigSnapshot.mockResolvedValue({
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
    mockRedisSet.mockReset();
    mockRedisSet.mockResolvedValueOnce("OK");

    const result = await mod.rebuildPublicStatusProjection({
      intervalMinutes: 5,
      rangeHours: 24,
      now: new Date("2026-04-21T10:02:00.000Z"),
    });

    expect(result.status).toBe("updated");
    const versionedManifestKey = buildPublicStatusManifestKey({
      configVersion: "cfg-1",
      intervalMinutes: 5,
      rangeHours: 24,
    });
    const versionedManifestCall = mockRedisSet.mock.calls.find((call) => call[0] === versionedManifestKey);

    expect(versionedManifestCall).toBeTruthy();

    const manifestValue = JSON.parse(String(versionedManifestCall?.[1]));
    expect(manifestValue.configVersion).toBe("cfg-1");
    expect(manifestValue.lastCompleteGeneration).toBeTruthy();
    expect(mockRedisDel).toHaveBeenCalled();

    const snapshotKey = buildPublicStatusCurrentSnapshotKey({
      intervalMinutes: 5,
      rangeHours: 24,
      generation: manifestValue.lastCompleteGeneration,
    });
    expect(mockRedisSet).toHaveBeenCalledWith(snapshotKey, expect.any(String));
  });

  it("writes rebuild hints with ttl and reason payload", async () => {
    const mod = await import("@/lib/public-status/rebuild-hints");

    await mod.schedulePublicStatusRebuild({
      intervalMinutes: 15,
      rangeHours: 48,
      reason: "manifest-missing",
    });

    const hintKey = buildPublicStatusRebuildHintKey({
      intervalMinutes: 15,
      rangeHours: 48,
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      hintKey,
      expect.stringContaining("manifest-missing"),
      "EX",
      300
    );
  });
});
