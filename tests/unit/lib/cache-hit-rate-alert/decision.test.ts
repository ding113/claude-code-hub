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

  it("should not trigger drop_abs_rel when only one threshold is met", () => {
    // 仅满足 dropAbs，不满足 dropRel
    const onlyAbs = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.6 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.8 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, dropAbs: 0.1, dropRel: 0.3 },
    });
    expect(onlyAbs).toHaveLength(0);

    // 仅满足 dropRel，不满足 dropAbs
    const onlyRel = decideCacheHitRateAnomalies({
      current: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.14 })],
      prev: [metric({ providerId: 1, model: "m", hitRateTokensEligible: 0.2 })],
      today: [],
      historical: [],
      settings: { ...defaultSettings, absMin: 0.01, dropAbs: 0.1, dropRel: 0.3 },
    });
    expect(onlyRel).toHaveLength(0);
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
});
