import { describe, expect, test } from "vitest";
import {
  formatLongContextMultiplier,
  formatLongContextObservedTokens,
  formatLongContextThreshold,
  getLongContextTierMultiplierRows,
} from "@/lib/utils/long-context-tier-display";
import type { StoredLongContextTier } from "@/types/cost-breakdown";

const TIER: StoredLongContextTier = {
  threshold_tokens: 272000,
  observed_input_tokens: 272001,
  input_multiplier: 2,
  output_multiplier: 1.5,
  cache_creation_5m_multiplier: 2,
  cache_creation_1h_multiplier: 1.25,
  cache_read_multiplier: 2,
};

describe("long-context tier display", () => {
  test("formats multipliers without trailing zeros", () => {
    expect(formatLongContextMultiplier(2)).toBe("×2");
    expect(formatLongContextMultiplier(1.5)).toBe("×1.5");
    expect(formatLongContextMultiplier(1.33333)).toBe("×1.3333");
  });

  test("formats the threshold compactly and the observed context exactly", () => {
    expect(formatLongContextThreshold(272000)).toBe("272K");
    expect(formatLongContextThreshold(200000)).toBe("200K");
    expect(formatLongContextObservedTokens(272001)).toBe((272001).toLocaleString());
  });

  test("lists input, output, cache write and cache read when no 1h cache was used", () => {
    expect(getLongContextTierMultiplierRows(TIER, false)).toEqual([
      { dimension: "input", multiplier: "×2" },
      { dimension: "output", multiplier: "×1.5" },
      { dimension: "cacheWrite", multiplier: "×2" },
      { dimension: "cacheRead", multiplier: "×2" },
    ]);
  });

  test("adds the 1h cache write multiplier only when the request used 1h cache", () => {
    expect(getLongContextTierMultiplierRows(TIER, true)).toContainEqual({
      dimension: "cacheWrite1h",
      multiplier: "×1.25",
    });
  });

  test("skips dimensions without a tier price", () => {
    expect(
      getLongContextTierMultiplierRows(
        { threshold_tokens: 200000, observed_input_tokens: 250000, input_multiplier: 2 },
        true
      )
    ).toEqual([{ dimension: "input", multiplier: "×2" }]);
  });
});
