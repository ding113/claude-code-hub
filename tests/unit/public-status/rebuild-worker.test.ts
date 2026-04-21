import { describe, expect, it, vi } from "vitest";
import { importPublicStatusModule } from "../../helpers/public-status-test-helpers";

interface RebuildWorkerModule {
  runPublicStatusRebuild(input: {
    flightKey: string;
    computeGeneration: () => Promise<{ sourceGeneration: string }>;
  }): Promise<{ sourceGeneration: string }>;
}

describe("public-status rebuild worker", () => {
  it("collapses concurrent rebuild requests into a single in-flight computation", async () => {
    const mod = await importPublicStatusModule<RebuildWorkerModule>(
      "@/lib/public-status/rebuild-worker"
    );

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
});
