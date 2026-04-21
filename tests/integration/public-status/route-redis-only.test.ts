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

vi.mock("@/lib/public-status/rebuild-worker", () => ({
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

  it("does not trigger rebuild for non-default public queries", async () => {
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
    });
    mockReadPublicStatusPayload.mockImplementation(async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
      await triggerRebuildHint("manifest-missing");
      return {
        rebuildState: "rebuilding",
        sourceGeneration: "",
        generatedAt: null,
        freshUntil: null,
        groups: [],
      };
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(
      new Request("http://localhost/api/public-status?interval=15&rangeHours=48")
    );

    expect(response.status).toBe(503);
    expect(mockSchedulePublicStatusRebuild).not.toHaveBeenCalled();
  });
});
