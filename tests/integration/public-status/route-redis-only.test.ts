import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockReadPublicStatusPayload = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
}));

vi.mock("@/lib/public-status/read-store", () => ({
  readPublicStatusPayload: mockReadPublicStatusPayload,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
}));

describe("GET /api/public-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 with rebuilding payload when snapshot is missing", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue(null);
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "rebuilding",
      sourceGeneration: "",
      generatedAt: null,
      freshUntil: null,
      groups: [],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      rebuildState: "rebuilding",
      groups: [],
    });
  });

  it("returns 200 with redis-projected payload when data exists", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "openai" }],
    });
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-21T10:00:00.000Z",
      freshUntil: "2026-04-21T10:05:00.000Z",
      groups: [],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(
      new Request("http://localhost/api/public-status?interval=5m&rangeHours=24")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
    });
  });

  it("returns 200 with stale payload and queues rebuild for the default query", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "openai" }],
    });
    mockReadPublicStatusPayload.mockImplementation(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("stale-generation");
        return {
          rebuildState: "stale",
          sourceGeneration: "gen-stale",
          generatedAt: "2026-04-21T09:55:00.000Z",
          freshUntil: "2026-04-21T10:00:00.000Z",
          groups: [],
        };
      }
    );
    mockSchedulePublicStatusRebuild.mockResolvedValue({
      accepted: true,
      rebuildState: "rebuilding",
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rebuildState: "stale",
      sourceGeneration: "gen-stale",
    });
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "stale-generation",
    });
  });

  it("returns 200 with no-data payload when no public groups are configured", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-empty",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "no-data",
      sourceGeneration: "",
      generatedAt: null,
      freshUntil: null,
      groups: [],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rebuildState: "no-data",
      groups: [],
    });
    expect(mockReadPublicStatusPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        hasConfiguredGroups: false,
      })
    );
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("queues rebuilds for non-default public queries when wider data is missing", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "openai" }],
    });
    mockReadPublicStatusPayload.mockImplementation(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("manifest-missing");
        return {
          rebuildState: "rebuilding",
          sourceGeneration: "",
          generatedAt: null,
          freshUntil: null,
          groups: [],
        };
      }
    );

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(
      new Request("http://localhost/api/public-status?interval=15&rangeHours=48")
    );

    expect(response.status).toBe(503);
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 15,
      rangeHours: 48,
      reason: "manifest-missing",
    });
  });
});
