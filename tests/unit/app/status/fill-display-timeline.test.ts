import { describe, expect, it } from "vitest";
import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { fillDisplayTimeline } from "@/app/[locale]/status/_lib/fill-display-timeline";

function bucket(
  state: PublicStatusTimelineBucket["state"],
  pct: number | null,
  index: number
): PublicStatusTimelineBucket {
  return {
    bucketStart: `2026-04-22T00:${String(index).padStart(2, "0")}:00.000Z`,
    bucketEnd: `2026-04-22T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
    state,
    availabilityPct: pct,
    ttfbMs: state === "no_data" ? null : 200,
    tps: state === "no_data" ? null : 50,
    sampleCount: state === "no_data" ? 0 : 5,
  };
}

describe("fillDisplayTimeline", () => {
  it("fills middle no_data when both sides equal", () => {
    const result = fillDisplayTimeline([
      bucket("operational", 100, 0),
      bucket("no_data", null, 1),
      bucket("no_data", null, 2),
      bucket("operational", 100, 3),
    ]);
    expect(result.map((c) => c.displayState)).toEqual([
      "operational",
      "operational",
      "operational",
      "operational",
    ]);
    expect(result[1].inferred).toBe(true);
    expect(result[2].inferred).toBe(true);
    expect(result[0].inferred).toBe(false);
  });

  it("uses nearest known state for middle gap with different sides", () => {
    const result = fillDisplayTimeline([
      bucket("operational", 100, 0),
      bucket("no_data", null, 1),
      bucket("no_data", null, 2),
      bucket("no_data", null, 3),
      bucket("failed", 0, 4),
    ]);
    expect(result.map((c) => c.displayState)).toEqual([
      "operational",
      "operational",
      "operational",
      "failed",
      "failed",
    ]);
  });

  it("breaks tie by preferring left side", () => {
    const result = fillDisplayTimeline([
      bucket("operational", 100, 0),
      bucket("no_data", null, 1),
      bucket("failed", 0, 2),
    ]);
    expect(result[1].displayState).toBe("operational");
  });

  it("extends head no_data using first known state", () => {
    const result = fillDisplayTimeline([
      bucket("no_data", null, 0),
      bucket("no_data", null, 1),
      bucket("failed", 0, 2),
    ]);
    expect(result.map((c) => c.displayState)).toEqual(["failed", "failed", "failed"]);
  });

  it("extends tail no_data using last known state", () => {
    const result = fillDisplayTimeline([
      bucket("operational", 100, 0),
      bucket("no_data", null, 1),
      bucket("no_data", null, 2),
    ]);
    expect(result.map((c) => c.displayState)).toEqual([
      "operational",
      "operational",
      "operational",
    ]);
    expect(result[2].inferred).toBe(true);
  });

  it("keeps no_data when timeline has no known state", () => {
    const result = fillDisplayTimeline([bucket("no_data", null, 0), bucket("no_data", null, 1)]);
    expect(result.map((c) => c.displayState)).toEqual(["no_data", "no_data"]);
    expect(result[0].inferred).toBe(false);
  });

  it("does not mutate the original bucket objects", () => {
    const original = [bucket("operational", 100, 0), bucket("no_data", null, 1)];
    const snapshot = JSON.stringify(original);
    fillDisplayTimeline(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("derives degraded for partial availability when filling", () => {
    const result = fillDisplayTimeline([
      bucket("operational", 80, 0),
      bucket("no_data", null, 1),
      bucket("operational", 80, 2),
    ]);
    expect(result.map((c) => c.displayState)).toEqual(["degraded", "degraded", "degraded"]);
  });
});
