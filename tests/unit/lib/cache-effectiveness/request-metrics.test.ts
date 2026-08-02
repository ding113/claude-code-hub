import { describe, expect, test } from "vitest";
import { deriveRequestCacheMetrics } from "@/lib/cache-effectiveness/request-metrics";

const eligible = {
  inputTokens: 100,
  cacheCreationInputTokens: 20,
  cacheReadInputTokens: 30,
  theoreticalCacheTokens: 60,
  cacheScoreEligible: true,
  cacheScoreExcludedReason: null,
  sessionIdentityKind: "prefix_affinity" as const,
};

describe("deriveRequestCacheMetrics", () => {
  test("derives actual rate, theoretical rate, and raw coefficient", () => {
    expect(deriveRequestCacheMetrics(eligible)).toEqual({
      cacheInputTotal: 150,
      actualCacheRate: 0.2,
      theoreticalCacheRate: 0.4,
      requestCacheCoefficientBp: 5000,
      requestCacheMetricAvailability: "available",
    });
  });

  test("keeps zero actual cache rate when input exists", () => {
    expect(
      deriveRequestCacheMetrics({
        ...eligible,
        cacheReadInputTokens: 0,
      }).actualCacheRate
    ).toBe(0);
  });

  test("returns no_input without fabricating zero rates", () => {
    expect(
      deriveRequestCacheMetrics({
        ...eligible,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      })
    ).toMatchObject({
      actualCacheRate: null,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "no_input",
    });
  });

  test("marks missing prefix provenance as unavailable", () => {
    expect(
      deriveRequestCacheMetrics({
        ...eligible,
        theoreticalCacheTokens: null,
        cacheScoreEligible: false,
        cacheScoreExcludedReason: "no_affinity_key",
        sessionIdentityKind: "session_id",
      })
    ).toMatchObject({
      actualCacheRate: 0.2,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "no_affinity_key",
    });
  });

  test("uses no_affinity_key when a recorded request has no theoretical token estimate", () => {
    expect(
      deriveRequestCacheMetrics({
        ...eligible,
        theoreticalCacheTokens: null,
        cacheScoreEligible: false,
        cacheScoreExcludedReason: null,
      })
    ).toMatchObject({
      actualCacheRate: 0.2,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "no_affinity_key",
    });
  });

  test.each(["attempt_failed", "not_observable", "stream_truncated"] as const)(
    "keeps observable rates but suppresses coefficient for %s",
    (reason) => {
      expect(
        deriveRequestCacheMetrics({
          ...eligible,
          cacheScoreEligible: false,
          cacheScoreExcludedReason: reason,
        })
      ).toMatchObject({
        actualCacheRate: 0.2,
        theoreticalCacheRate: 0.4,
        requestCacheCoefficientBp: null,
        requestCacheMetricAvailability: reason,
      });
    }
  );

  test("clamps rates and coefficient to their display bounds", () => {
    expect(
      deriveRequestCacheMetrics({
        ...eligible,
        cacheReadInputTokens: 90,
        theoreticalCacheTokens: 10,
      })
    ).toMatchObject({
      actualCacheRate: 90 / 210,
      theoreticalCacheRate: 10 / 210,
      requestCacheCoefficientBp: 10000,
    });
  });

  test("identifies old rows with no F3b fields", () => {
    expect(
      deriveRequestCacheMetrics({
        inputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 20,
        theoreticalCacheTokens: null,
        cacheScoreEligible: null,
        cacheScoreExcludedReason: null,
        sessionIdentityKind: null,
      })
    ).toMatchObject({
      actualCacheRate: 1 / 6,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "legacy_unrecorded",
    });
  });

  test("does not treat a historical Session identity as recorded F3b provenance", () => {
    expect(
      deriveRequestCacheMetrics({
        inputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 20,
        theoreticalCacheTokens: null,
        cacheScoreEligible: null,
        cacheScoreExcludedReason: null,
        sessionIdentityKind: "session_id",
      })
    ).toMatchObject({
      requestCacheMetricAvailability: "legacy_unrecorded",
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
    });
  });
});
