import { describe, expect, it } from "vitest";
import type { HedgeLoserBilling } from "@/types/cost-breakdown";
import { findHedgeLoserCost, summarizeHedgeBilling } from "@/lib/utils/hedge-billing";

function loser(overrides: Partial<HedgeLoserBilling>): HedgeLoserBilling {
  return {
    providerId: 1,
    providerName: "p1",
    attemptNumber: 2,
    costUsd: "0.001",
    ...overrides,
  };
}

describe("summarizeHedgeBilling", () => {
  it("returns null when there are no losers", () => {
    expect(summarizeHedgeBilling("0.01", null)).toBeNull();
    expect(summarizeHedgeBilling("0.01", [])).toBeNull();
    expect(summarizeHedgeBilling("0.01", undefined)).toBeNull();
  });

  it("splits total into winner + losers (winner = total - sum(losers))", () => {
    const summary = summarizeHedgeBilling("0.010", [
      loser({ providerId: 2, providerName: "loserA", costUsd: "0.003" }),
      loser({ providerId: 3, providerName: "loserB", costUsd: "0.002" }),
    ]);
    expect(summary).not.toBeNull();
    expect(Number(summary?.loserTotal)).toBeCloseTo(0.005, 9);
    expect(Number(summary?.winnerCost)).toBeCloseTo(0.005, 9);
    expect(Number(summary?.total)).toBeCloseTo(0.01, 9);
    expect(summary?.losers).toHaveLength(2);
  });

  it("clamps winner cost to zero when loser total exceeds total (rounding safety)", () => {
    const summary = summarizeHedgeBilling("0.001", [loser({ costUsd: "0.002" })]);
    expect(Number(summary?.winnerCost)).toBe(0);
    expect(Number(summary?.loserTotal)).toBeCloseTo(0.002, 9);
  });

  it("treats a null total as zero", () => {
    const summary = summarizeHedgeBilling(null, [loser({ costUsd: "0.5" })]);
    expect(Number(summary?.total)).toBe(0);
    expect(Number(summary?.winnerCost)).toBe(0);
    expect(Number(summary?.loserTotal)).toBeCloseTo(0.5, 9);
  });
});

describe("findHedgeLoserCost", () => {
  const losers = [
    loser({ providerId: 2, attemptNumber: 2, costUsd: "0.003" }),
    loser({ providerId: 3, attemptNumber: 3, costUsd: "0.004" }),
  ];

  it("matches by providerId + attemptNumber", () => {
    expect(findHedgeLoserCost(losers, 3, 3)?.costUsd).toBe("0.004");
  });

  it("matches by providerId only when attemptNumber is nullish", () => {
    expect(findHedgeLoserCost(losers, 2, null)?.providerId).toBe(2);
    expect(findHedgeLoserCost(losers, 2, undefined)?.providerId).toBe(2);
  });

  it("returns null when not found or inputs are missing", () => {
    expect(findHedgeLoserCost(losers, 99, 1)).toBeNull();
    expect(findHedgeLoserCost(null, 2, 2)).toBeNull();
    expect(findHedgeLoserCost(losers, null, 2)).toBeNull();
  });
});
