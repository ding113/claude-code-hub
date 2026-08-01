import { describe, expect, it } from "vitest";
import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import {
  CHART_BUCKETS,
  computeAvgTtft,
  computeUptimePct,
  sliceTimelineForChart,
} from "@/app/[locale]/status/_lib/timeline-windows";

function makeBucket(
  index: number,
  overrides: Partial<PublicStatusTimelineBucket> = {}
): PublicStatusTimelineBucket {
  return {
    bucketStart: `2026-04-22T${String(Math.floor(index / 12)).padStart(2, "0")}:${String((index % 12) * 5).padStart(2, "0")}:00.000Z`,
    bucketEnd: "",
    state: "operational",
    availabilityPct: 100,
    ttftMs: 200,
    tps: 50,
    sampleCount: 10,
    ...overrides,
  };
}

describe("sliceTimelineForChart", () => {
  it("returns the full array when shorter than chart buckets", () => {
    const t = Array.from({ length: 10 }, (_, i) => makeBucket(i));
    expect(sliceTimelineForChart(t)).toHaveLength(10);
  });

  it("slices the last N buckets when longer than chart buckets", () => {
    const t = Array.from({ length: 288 }, (_, i) => makeBucket(i));
    const result = sliceTimelineForChart(t);
    expect(result).toHaveLength(CHART_BUCKETS);
    expect(result[0]).toBe(t[t.length - CHART_BUCKETS]);
    expect(result[result.length - 1]).toBe(t[t.length - 1]);
  });

  it("respects custom chart buckets size", () => {
    const t = Array.from({ length: 100 }, (_, i) => makeBucket(i));
    expect(sliceTimelineForChart(t, 30)).toHaveLength(30);
  });
});

describe("computeUptimePct", () => {
  it("returns null when no samples", () => {
    expect(computeUptimePct([])).toBeNull();
    expect(
      computeUptimePct([makeBucket(0, { sampleCount: 0, availabilityPct: null, state: "no_data" })])
    ).toBeNull();
  });

  it("computes weighted average across buckets", () => {
    const result = computeUptimePct([
      makeBucket(0, { availabilityPct: 100, sampleCount: 8 }),
      makeBucket(1, { availabilityPct: 50, sampleCount: 2 }),
    ]);
    expect(result).toBe(90);
  });

  it("ignores buckets with no samples", () => {
    const result = computeUptimePct([
      makeBucket(0, { availabilityPct: 100, sampleCount: 5 }),
      makeBucket(1, { availabilityPct: null, sampleCount: 0, state: "no_data" }),
    ]);
    expect(result).toBe(100);
  });
});

describe("computeAvgTtft", () => {
  it("returns null when no samples", () => {
    expect(computeAvgTtft([])).toBeNull();
  });

  it("computes weighted integer average", () => {
    const result = computeAvgTtft([
      makeBucket(0, { ttftMs: 100, sampleCount: 4 }),
      makeBucket(1, { ttftMs: 300, sampleCount: 4 }),
    ]);
    expect(result).toBe(200);
  });

  it("skips buckets with null ttft", () => {
    const result = computeAvgTtft([
      makeBucket(0, { ttftMs: 200, sampleCount: 5 }),
      makeBucket(1, { ttftMs: null, sampleCount: 5 }),
    ]);
    expect(result).toBe(200);
  });
});
