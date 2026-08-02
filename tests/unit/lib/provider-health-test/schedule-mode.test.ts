import { describe, expect, it } from "vitest";

import { shouldRunSloRebalance } from "@/lib/provider-health-test/schedule-mode";

describe("shouldRunSloRebalance", () => {
  it("runs the historical dynamic policy by default", () => {
    expect(shouldRunSloRebalance("dynamic")).toBe(true);
    expect(shouldRunSloRebalance(undefined)).toBe(true);
    expect(shouldRunSloRebalance(null)).toBe(true);
  });

  it("skips SLO auto-rebalance in always-on mode", () => {
    expect(shouldRunSloRebalance("always_on")).toBe(false);
  });
});
