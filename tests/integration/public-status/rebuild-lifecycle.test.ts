import { describe, expect, it, vi } from "vitest";

const mockRedisSet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    status: "ready",
  }),
}));

describe("public-status rebuild lifecycle", () => {
  it("persists a rebuild hint for widened ranges and cold starts", async () => {
    const mod = await import("@/lib/public-status/rebuild-worker");

    const result = await mod.schedulePublicStatusRebuild({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "task-1-red-test",
    });

    expect(result.accepted).toBe(true);
    expect(result.rebuildState).toBe("rebuilding");
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
  });
});
