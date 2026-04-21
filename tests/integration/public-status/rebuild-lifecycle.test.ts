import { describe, expect, it } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface RebuildLifecycleModule {
  schedulePublicStatusRebuild(input: {
    intervalMinutes: number;
    rangeHours: number;
    reason: string;
  }): Promise<{
    accepted: boolean;
    rebuildState: string;
  }>;
}

describe("public-status rebuild lifecycle", () => {
  it("reserves an async rebuild lifecycle for widened ranges and cold starts", async () => {
    const mod = await importPublicStatusModule<RebuildLifecycleModule>(
      "@/lib/public-status/rebuild-worker"
    );

    const result = await mod.schedulePublicStatusRebuild({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "task-1-red-test",
    });

    expect(result.accepted).toBe(true);
    expect(result.rebuildState).toBeTruthy();
  });
});
