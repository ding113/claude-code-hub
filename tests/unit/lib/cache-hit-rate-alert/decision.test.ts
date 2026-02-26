import { describe, expect, it } from "vitest";
import {
  decideCacheHitRateAnomalies,
  type CacheHitRateAlertMetric,
  type CacheHitRateAlertDecisionSettings,
} from "@/lib/cache-hit-rate-alert/decision";

function metric(
  input: Partial<CacheHitRateAlertMetric> & { providerId: number; model: string }
): CacheHitRateAlertMetric {
  return {
    providerId: input.providerId,
    model: input.model,
    totalRequests: input.totalRequests ?? 100,
    denominatorTokens: input.denominatorTokens ?? 10000,
    hitRateTokens: input.hitRateTokens ?? 0,
    eligibleRequests: input.eligibleRequests ?? 100,
    eligibleDenominatorTokens: input.eligibleDenominatorTokens ?? 10000,
    hitRateTokensEligible: input.hitRateTokensEligible ?? input.hitRateTokens ?? 0,
  };
}

const defaultSettings: CacheHitRateAlertDecisionSettings = {
  absMin: 0.05,
  dropRel: 0.3,
  dropAbs: 0.1,
  minEligibleRequests: 20,
  minEligibleTokens: 0,
  topN: 10,
};

describe("decideCacheHitRateAnomalies", () => {
  it("should return empty when topN is 0", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, topN: 0 },
    });

    expect(anomalies).toHaveLength(0);
  });

  it("should prefer historical baseline over today/prev", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.4 })],
      today: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.35 })],
      historical: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5 })],
      settings: defaultSettings,
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baselineSource).toBe("historical");
  });

  it("should fall back to today baseline when historical kind-sample is insufficient", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.4 })],
      today: [
        metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5, eligibleRequests: 50 }),
      ],
      historical: [
        metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.9, eligibleRequests: 1 }),
      ],
      settings: defaultSettings,
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baselineSource).toBe("today");
  });

  it("should fall back to prev baseline when historical/today kind-samples are insufficient", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.1 })],
      prev: [
        metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.6, eligibleRequests: 50 }),
      ],
      today: [
        metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.9, eligibleRequests: 1 }),
      ],
      historical: [
        metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.9, eligibleRequests: 1 }),
      ],
      settings: { ...defaultSettings, absMin: 0.01 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baselineSource).toBe("prev");
  });

  it("should treat baseline as insufficient when eligible tokens below minEligibleTokens", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({
          providerId: 1,
          model: "m",
          eligibleRequests: 50,
          eligibleDenominatorTokens: 2000,
          hitRateTokensEligible: 0.1,
        }),
      ],
      prev: [],
      today: [
        metric({
          providerId: 1,
          model: "m",
          eligibleRequests: 50,
          eligibleDenominatorTokens: 2000,
          hitRateTokensEligible: 0.6,
        }),
      ],
      historical: [
        metric({
          providerId: 1,
          model: "m",
          eligibleRequests: 50,
          eligibleDenominatorTokens: 10,
          hitRateTokensEligible: 0.9,
        }),
      ],
      settings: { ...defaultSettings, absMin: 0.01, minEligibleTokens: 1000 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baselineSource).toBe("today");
  });

  it("should fall back to overall when eligible sample is insufficient", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({
          providerId: 1,
          model: "m",
          totalRequests: 100,
          denominatorTokens: 10000,
          hitRateTokens: 0.1,
          eligibleRequests: 1,
          eligibleDenominatorTokens: 100,
          hitRateTokensEligible: 0,
        }),
      ],
      prev: [
        metric({
          providerId: 1,
          model: "m",
          totalRequests: 100,
          denominatorTokens: 10000,
          hitRateTokens: 0.5,
          eligibleRequests: 1,
          eligibleDenominatorTokens: 100,
          hitRateTokensEligible: 0.5,
        }),
      ],
      today: [],
      historical: [],
      settings: defaultSettings,
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].current.kind).toBe("overall");
    expect(anomalies[0].baseline?.kind).toBe("overall");
    expect(anomalies[0].reasonCodes).toContain("eligible_insufficient");
  });

  it("should fall back to overall when eligible tokens are insufficient", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({
          providerId: 1,
          model: "m",
          totalRequests: 50,
          denominatorTokens: 2000,
          hitRateTokens: 0.1,
          eligibleRequests: 50,
          eligibleDenominatorTokens: 10,
          hitRateTokensEligible: 0.9,
        }),
      ],
      prev: [
        metric({
          providerId: 1,
          model: "m",
          totalRequests: 50,
          denominatorTokens: 2000,
          hitRateTokens: 0.6,
          eligibleRequests: 50,
          eligibleDenominatorTokens: 10,
          hitRateTokensEligible: 0.9,
        }),
      ],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, minEligibleTokens: 1000 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].current.kind).toBe("overall");
    expect(anomalies[0].baseline?.kind).toBe("overall");
    expect(anomalies[0].reasonCodes).toContain("eligible_insufficient");
    expect(anomalies[0].reasonCodes).toContain("use_overall");
  });

  it("should not compare eligible current against overall baseline", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({
          providerId: 1,
          model: "m",
          eligibleRequests: 100,
          eligibleDenominatorTokens: 10000,
          hitRateTokensEligible: 0.2,
          totalRequests: 100,
          denominatorTokens: 10000,
          hitRateTokens: 0.2,
        }),
      ],
      prev: [
        metric({
          providerId: 1,
          model: "m",
          // baseline eligible 不足，但 overall 足够
          eligibleRequests: 1,
          eligibleDenominatorTokens: 100,
          hitRateTokensEligible: 0.9,
          totalRequests: 100,
          denominatorTokens: 10000,
          hitRateTokens: 0.9,
        }),
      ],
      today: [],
      historical: [],
      settings: defaultSettings,
    });

    expect(anomalies).toHaveLength(0);
  });

  it("should filter invalid metrics in map inputs", () => {
    const current = new Map<string, CacheHitRateAlertMetric>([
      ["k1", metric({ providerId: 1, model: "", hitRateTokensEligible: 0 })],
      ["k2", metric({ providerId: 2, model: "m", hitRateTokensEligible: 0 })],
    ]);

    const prev = new Map<string, CacheHitRateAlertMetric>([
      ["k1", metric({ providerId: 1, model: "", hitRateTokensEligible: 0.2 })],
      ["k2", metric({ providerId: 2, model: "m", hitRateTokensEligible: 0.2 })],
    ]);

    const anomalies = decideCacheHitRateAnomalies({
      current,
      prev,
      today: new Map<string, CacheHitRateAlertMetric>(),
      historical: new Map<string, CacheHitRateAlertMetric>(),
      settings: { ...defaultSettings, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].providerId).toBe(2);
    expect(anomalies[0].model).toBe("m");
  });

  it("should return empty when eligible and overall samples are insufficient", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({
          providerId: 1,
          model: "m",
          totalRequests: 1,
          denominatorTokens: 10,
          hitRateTokens: 0,
          eligibleRequests: 1,
          eligibleDenominatorTokens: 10,
          hitRateTokensEligible: 0,
        }),
      ],
      prev: [],
      today: [],
      historical: [],
      settings: { ...defaultSettings, minEligibleRequests: 20, minEligibleTokens: 1000 },
    });

    expect(anomalies).toHaveLength(0);
  });

  it("should trigger drop_abs_rel when thresholds are met", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasonCodes).toContain("drop_abs_rel");
    expect(anomalies[0].dropAbs).toBeCloseTo(0.3, 10);
  });

  it("should not trigger drop_abs_rel when only dropAbs is met (AND)", () => {
    // baseline=0.5, current=0.375
    // dropAbs=0.125 >= 0.1（满足），dropRel=0.125/0.5=0.25 < 0.3（不满足）
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.375 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, dropAbs: 0.1, dropRel: 0.3 },
    });

    expect(anomalies).toHaveLength(0);
  });

  it("should not trigger drop_abs_rel when only dropRel is met (AND)", () => {
    // baseline=0.25, current=0.15625
    // dropAbs=0.09375 < 0.1（不满足），dropRel=0.09375/0.25=0.375 >= 0.3（满足）
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.15625 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.25 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, dropAbs: 0.1, dropRel: 0.3 },
    });

    expect(anomalies).toHaveLength(0);
  });

  it("should trigger abs_min when current is below absMin", () => {
    const shouldTrigger = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.03 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(shouldTrigger).toHaveLength(1);
    expect(shouldTrigger[0].reasonCodes).toContain("abs_min");

    const shouldNotTrigger = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.06 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.04 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(shouldNotTrigger).toHaveLength(0);
  });

  it("abs_min should not trigger when current equals absMin", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.05 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.5 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.05, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(anomalies).toHaveLength(0);
  });

  it("abs_min 在缺失基线时也应触发", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.01 })],
      prev: [],
      today: [],
      historical: [],
      settings: { ...defaultSettings, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baselineSource).toBeNull();
    expect(anomalies[0].baseline).toBeNull();
    expect(anomalies[0].deltaAbs).toBeNull();
    expect(anomalies[0].deltaRel).toBeNull();
    expect(anomalies[0].dropAbs).toBeNull();
    expect(anomalies[0].reasonCodes).toContain("baseline_missing");
    expect(anomalies[0].reasonCodes).toContain("abs_min");
  });

  it("dropAbs 在 current 高于 baseline 且仅触发 abs_min 时应 clamp 为 0", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.04 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.01 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.05, dropAbs: 0.1, dropRel: 0.3 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasonCodes).toContain("abs_min");
    expect(anomalies[0].reasonCodes).not.toContain("drop_abs_rel");
    expect(anomalies[0].dropAbs).toBe(0);
  });

  it("should set deltaRel to null when baseline hit rate is 0", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, dropAbs: 0.9, dropRel: 0.9 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].baseline?.hitRateTokens).toBe(0);
    expect(anomalies[0].deltaRel).toBeNull();
  });

  it("should trigger drop_abs_rel when thresholds are met exactly (>=)", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.3 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.4 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, dropAbs: 0.1, dropRel: 0.25 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasonCodes).toContain("drop_abs_rel");
    expect(anomalies[0].dropAbs).toBeCloseTo(0.1, 10);
  });

  it("should not add drop_abs_rel when only dropAbs is met (AND) even if abs_min triggers", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.04 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.06 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.05, dropAbs: 0.01, dropRel: 0.5 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasonCodes).toContain("abs_min");
    expect(anomalies[0].reasonCodes).not.toContain("drop_abs_rel");
  });

  it("should not add drop_abs_rel when only dropRel is met (AND) even if abs_min triggers", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.02 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.04 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.05, dropAbs: 0.03, dropRel: 0.5 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasonCodes).toContain("abs_min");
    expect(anomalies[0].reasonCodes).not.toContain("drop_abs_rel");
  });

  it("should sort by severity and respect topN", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({ providerId: 1, model: "a", hitRateTokensEligible: 0.1 }),
        metric({ providerId: 2, model: "b", hitRateTokensEligible: 0.25 }),
      ],
      prev: [
        metric({ providerId: 1, model: "a", hitRateTokensEligible: 0.6 }),
        metric({ providerId: 2, model: "b", hitRateTokensEligible: 0.5 }),
      ],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, topN: 1 },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].providerId).toBe(1);
    expect(anomalies[0].model).toBe("a");
  });

  it("should break severity ties by providerId/model for deterministic ordering", () => {
    const anomalies = decideCacheHitRateAnomalies({
      current: [
        metric({ providerId: 2, model: "b", hitRateTokensEligible: 0.1 }),
        metric({ providerId: 1, model: "a", hitRateTokensEligible: 0.1 }),
      ],
      prev: [
        metric({ providerId: 2, model: "b", hitRateTokensEligible: 0.6 }),
        metric({ providerId: 1, model: "a", hitRateTokensEligible: 0.6 }),
      ],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, topN: 2 },
    });

    expect(anomalies).toHaveLength(2);
    expect(anomalies[0].providerId).toBe(1);
    expect(anomalies[0].model).toBe("a");
    expect(anomalies[1].providerId).toBe(2);
    expect(anomalies[1].model).toBe("b");
  });
});
