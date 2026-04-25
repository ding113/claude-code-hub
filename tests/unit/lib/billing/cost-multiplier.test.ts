import { describe, expect, it } from "vitest";
import {
  applyCostMultiplierCorrection,
  applyCostMultiplierCorrectionToProvider,
  normalizeCostMultiplierCorrection,
} from "@/lib/billing/cost-multiplier";

describe("cost multiplier correction", () => {
  it("adds the global correction to the provider multiplier", () => {
    expect(applyCostMultiplierCorrection(1, 0.1)).toBe(1.1);
    expect(applyCostMultiplierCorrection(1.25, "0.1")).toBe(1.35);
  });

  it("treats invalid correction values as zero and clamps below zero", () => {
    expect(normalizeCostMultiplierCorrection("invalid")).toBe(0);
    expect(applyCostMultiplierCorrection(1, "invalid")).toBe(1);
    expect(applyCostMultiplierCorrection(0.05, -1)).toBe(0);
  });

  it("returns an adjusted provider copy when correction changes the multiplier", () => {
    const provider = { id: 1, costMultiplier: 1 };
    const adjusted = applyCostMultiplierCorrectionToProvider(provider, 0.1);

    expect(adjusted).toMatchObject({ id: 1, costMultiplier: 1.1 });
    expect(adjusted).not.toBe(provider);
  });
});
