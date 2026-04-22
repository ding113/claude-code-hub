import { describe, expect, it } from "vitest";
import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import {
  DEGRADED_THRESHOLD,
  deriveDisplayState,
  deriveLatestModelState,
} from "@/app/[locale]/status/_lib/derive-display-state";

function makeBucket(
  overrides: Partial<PublicStatusTimelineBucket> = {}
): PublicStatusTimelineBucket {
  return {
    bucketStart: "2026-04-22T00:00:00.000Z",
    bucketEnd: "2026-04-22T00:05:00.000Z",
    state: "operational",
    availabilityPct: 100,
    ttfbMs: 200,
    tps: 50,
    sampleCount: 10,
    ...overrides,
  };
}

describe("deriveDisplayState", () => {
  it("returns failed when state is failed", () => {
    expect(deriveDisplayState(makeBucket({ state: "failed" }))).toBe("failed");
  });

  it("returns no_data when state is no_data", () => {
    expect(deriveDisplayState(makeBucket({ state: "no_data", availabilityPct: null }))).toBe(
      "no_data"
    );
  });

  it("returns operational when availabilityPct is null", () => {
    expect(deriveDisplayState(makeBucket({ availabilityPct: null }))).toBe("operational");
  });

  it("returns operational when availabilityPct >= 100", () => {
    expect(deriveDisplayState(makeBucket({ availabilityPct: 100 }))).toBe("operational");
  });

  it("returns degraded when availabilityPct between threshold and 100", () => {
    expect(deriveDisplayState(makeBucket({ availabilityPct: 80 }))).toBe("degraded");
    expect(deriveDisplayState(makeBucket({ availabilityPct: DEGRADED_THRESHOLD }))).toBe(
      "degraded"
    );
  });

  it("collapses to failed when availabilityPct below threshold", () => {
    expect(deriveDisplayState(makeBucket({ availabilityPct: 30 }))).toBe("failed");
    expect(deriveDisplayState(makeBucket({ availabilityPct: 0 }))).toBe("failed");
  });
});

describe("deriveLatestModelState", () => {
  it("returns the most recent non-no_data bucket state", () => {
    const result = deriveLatestModelState({
      latestState: "no_data",
      timeline: [
        makeBucket({ state: "operational", availabilityPct: 100 }),
        makeBucket({ state: "no_data", availabilityPct: null }),
        makeBucket({ state: "no_data", availabilityPct: null }),
      ],
    });
    expect(result).toBe("operational");
  });

  it("returns failed when last known bucket is failed", () => {
    const result = deriveLatestModelState({
      latestState: "no_data",
      timeline: [
        makeBucket({ state: "operational" }),
        makeBucket({ state: "failed", availabilityPct: 0 }),
        makeBucket({ state: "no_data", availabilityPct: null }),
      ],
    });
    expect(result).toBe("failed");
  });

  it("returns no_data when timeline has only no_data", () => {
    const result = deriveLatestModelState({
      latestState: "no_data",
      timeline: [
        makeBucket({ state: "no_data", availabilityPct: null }),
        makeBucket({ state: "no_data", availabilityPct: null }),
      ],
    });
    expect(result).toBe("no_data");
  });

  it("returns degraded when last known availability is partial", () => {
    const result = deriveLatestModelState({
      latestState: "operational",
      timeline: [makeBucket({ state: "operational", availabilityPct: 75 })],
    });
    expect(result).toBe("degraded");
  });
});
