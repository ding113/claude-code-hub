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

  it("returns 200 with an explicit no-snapshot body when snapshot is missing", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue(null);
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
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "no_snapshot",
      rebuildState: {
        state: "rebuilding",
        hasSnapshot: false,
        reason: null,
      },
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
      status: "ready",
      rebuildState: {
        state: "fresh",
        hasSnapshot: true,
        reason: null,
      },
      defaults: {
        intervalMinutes: 5,
        rangeHours: 24,
      },
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
      status: "stale",
      rebuildState: {
        state: "stale",
        hasSnapshot: true,
        reason: null,
      },
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
      status: "no_data",
      rebuildState: {
        state: "no-data",
        hasSnapshot: false,
        reason: null,
      },
      groups: [],
    });
    expect(mockReadPublicStatusPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        hasConfiguredGroups: false,
      })
    );
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });

  it("returns 200 no-snapshot for non-default public queries when wider data is missing", async () => {
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "no_snapshot",
      rebuildState: {
        state: "rebuilding",
        hasSnapshot: false,
        reason: null,
      },
    });
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 15,
      rangeHours: 48,
      reason: "manifest-missing",
    });
  });

  it("returns no-store for rebuilding 503 responses", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "openai" }],
    });
    mockReadPublicStatusPayload.mockImplementation(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("redis-unavailable");
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
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
