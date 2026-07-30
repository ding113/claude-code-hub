import { describe, expect, it } from "vitest";
import { calculateOutputRate, shouldHideOutputRate } from "@/lib/utils/performance-formatter";

describe("performance timing metrics", () => {
  it("calculates output rate only from TTFT to completion", () => {
    expect(calculateOutputRate(100, 2_000, 500)).toBeCloseTo(66.6667, 3);
  });

  it("does not fabricate output rate when TTFT is unavailable", () => {
    expect(calculateOutputRate(100, 2_000, null)).toBeNull();
  });

  it("uses TTFT when detecting implausibly short generation windows", () => {
    const rate = calculateOutputRate(300, 1_000, 950);
    expect(shouldHideOutputRate(rate, 1_000, 950)).toBe(true);
  });
});
