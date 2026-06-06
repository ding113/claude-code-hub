import { describe, expect, it } from "vitest";
import type { HedgeLoserBilling } from "@/types/cost-breakdown";
import {
  buildHedgeBillingTable,
  findHedgeLoserCost,
  summarizeHedgeBilling,
} from "@/lib/utils/hedge-billing";

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

describe("buildHedgeBillingTable", () => {
  it("returns null when there are no losers", () => {
    expect(buildHedgeBillingTable("0.01", null, { inputTokens: 5 })).toBeNull();
    expect(buildHedgeBillingTable("0.01", [])).toBeNull();
  });

  it("puts the winner first, then losers sorted by attempt number", () => {
    const table = buildHedgeBillingTable(
      "0.010",
      [
        loser({ providerId: 3, providerName: "loserB", attemptNumber: 3, costUsd: "0.002" }),
        loser({ providerId: 2, providerName: "loserA", attemptNumber: 2, costUsd: "0.003" }),
      ],
      { providerId: 1, providerName: "winner", attemptNumber: 1 }
    );
    expect(table).not.toBeNull();
    expect(table?.attempts.map((a) => a.kind)).toEqual(["winner", "loser", "loser"]);
    expect(table?.attempts.map((a) => a.providerName)).toEqual(["winner", "loserA", "loserB"]);
    expect(table?.count).toBe(3);
    expect(Number(table?.winnerCost)).toBeCloseTo(0.005, 9);
    expect(Number(table?.total)).toBeCloseTo(0.01, 9);
  });

  it("sums token usage across every attempt", () => {
    const table = buildHedgeBillingTable(
      "0.02",
      [
        loser({
          providerId: 2,
          attemptNumber: 2,
          costUsd: "0.004",
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadInputTokens: 50,
        }),
      ],
      {
        inputTokens: 1000,
        outputTokens: 800,
        cacheCreationInputTokens: 300,
        cacheReadInputTokens: 0,
      }
    );
    expect(table?.tokenTotals).toEqual({
      inputTokens: 2000,
      outputTokens: 1000,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 50,
    });
    expect(table?.hasCacheRead).toBe(true);
    expect(table?.hasCacheWrite).toBe(true);
  });

  it("coerces missing/invalid token counts to zero and defaults provider fields to null", () => {
    const table = buildHedgeBillingTable("0.01", [
      loser({ providerId: 2, attemptNumber: 2, costUsd: "0.001", inputTokens: undefined }),
    ]);
    const winner = table?.attempts[0];
    expect(winner?.providerName).toBeNull();
    expect(winner?.attemptNumber).toBeNull();
    expect(winner?.inputTokens).toBe(0);
    expect(table?.attempts[1]?.inputTokens).toBe(0);
    expect(table?.hasCacheRead).toBe(false);
    expect(table?.hasCacheWrite).toBe(false);
  });

  it("clamps negative, NaN, and zero token counts to zero (toCount value>0 / isFinite guard)", () => {
    const table = buildHedgeBillingTable(
      "0.01",
      [
        loser({
          providerId: 2,
          attemptNumber: 2,
          costUsd: "0.001",
          inputTokens: -50,
          outputTokens: Number.NaN,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: Number.POSITIVE_INFINITY,
        }),
      ],
      { inputTokens: -1, outputTokens: Number.NaN }
    );
    const loserRow = table?.attempts[1];
    expect(loserRow?.inputTokens).toBe(0);
    expect(loserRow?.outputTokens).toBe(0);
    expect(loserRow?.cacheReadInputTokens).toBe(0);
    expect(loserRow?.cacheCreationInputTokens).toBe(0);
    expect(table?.attempts[0]?.inputTokens).toBe(0);
    expect(table?.attempts[0]?.outputTokens).toBe(0);
    expect(table?.tokenTotals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(table?.hasCacheRead).toBe(false);
    expect(table?.hasCacheWrite).toBe(false);
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
