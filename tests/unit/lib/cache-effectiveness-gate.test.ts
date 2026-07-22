import { describe, expect, it } from "vitest";
import type { FingerprintBoundary } from "@/app/v1/_lib/proxy/affinity/fingerprint";
import type { SessionAffinityState } from "@/app/v1/_lib/proxy/session";
import {
  CACHE_SCORE_EXCLUDED,
  type CacheScoreInput,
  computeCacheScoreFields,
} from "@/lib/cache-effectiveness/gate";

function boundary(depth: number, fp: string, prefixBytes: number): FingerprintBoundary {
  return { depth, fp, prefixBytes };
}

function makeAffinity(overrides: Partial<SessionAffinityState> = {}): SessionAffinityState {
  return {
    scopeTag: "k42",
    chain: {
      sys: boundary(0, "sysfp", 41),
      tail: [boundary(1, "tailfp1", 80), boundary(2, "tipfp", 103)],
    },
    nominatedProviderId: null,
    matchedFp: null,
    matchedTier: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<CacheScoreInput> = {}): CacheScoreInput {
  return {
    affinity: makeAffinity(),
    succeeded: true,
    usageObservable: true,
    streamTruncated: false,
    cacheTtl: null,
    ...overrides,
  };
}

describe("computeCacheScoreFields", () => {
  it("returns no_affinity_key with all-null fields when affinity is missing", () => {
    expect(computeCacheScoreFields(makeInput({ affinity: null }))).toEqual({
      cacheCompatibilityKey: null,
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.noAffinityKey,
      theoreticalCacheTokens: null,
      cacheTtlBucket: null,
    });
  });

  it("returns no_affinity_key when no boundary yields a fingerprint", () => {
    const affinity = makeAffinity({
      matchedFp: null,
      chain: { sys: boundary(0, "", 41), tail: [] },
    });
    const result = computeCacheScoreFields(makeInput({ affinity }));
    expect(result.cacheScoreEligible).toBe(false);
    expect(result.cacheScoreExcludedReason).toBe(CACHE_SCORE_EXCLUDED.noAffinityKey);
    expect(result.cacheCompatibilityKey).toBeNull();
  });

  it("excludes failed attempts but keeps key, theoretical tokens and ttl bucket", () => {
    const result = computeCacheScoreFields(makeInput({ succeeded: false }));
    expect(result).toEqual({
      cacheCompatibilityKey: "k42:tipfp",
      cacheScoreEligible: false,
      cacheScoreExcludedReason: CACHE_SCORE_EXCLUDED.attemptFailed,
      theoreticalCacheTokens: 25,
      cacheTtlBucket: "5m",
    });
  });

  it("excludes attempts without observable usage", () => {
    const result = computeCacheScoreFields(makeInput({ usageObservable: false }));
    expect(result.cacheScoreEligible).toBe(false);
    expect(result.cacheScoreExcludedReason).toBe(CACHE_SCORE_EXCLUDED.notObservable);
  });

  it("excludes truncated streams", () => {
    const result = computeCacheScoreFields(makeInput({ streamTruncated: true }));
    expect(result.cacheScoreEligible).toBe(false);
    expect(result.cacheScoreExcludedReason).toBe(CACHE_SCORE_EXCLUDED.streamTruncated);
  });

  it("short-circuits in gate order: attempt_failed wins over later exclusions", () => {
    const result = computeCacheScoreFields(
      makeInput({ succeeded: false, usageObservable: false, streamTruncated: true })
    );
    expect(result.cacheScoreExcludedReason).toBe(CACHE_SCORE_EXCLUDED.attemptFailed);
  });

  it("marks fully passing attempts eligible with scopeTag:fp key and floored tokens", () => {
    const result = computeCacheScoreFields(makeInput());
    expect(result).toEqual({
      cacheCompatibilityKey: "k42:tipfp",
      cacheScoreEligible: true,
      cacheScoreExcludedReason: null,
      // floor(103 / 4)
      theoreticalCacheTokens: 25,
      cacheTtlBucket: "5m",
    });
  });

  it("passes through a concrete ttl and defaults empty string to 5m", () => {
    expect(computeCacheScoreFields(makeInput({ cacheTtl: "1h" })).cacheTtlBucket).toBe("1h");
    expect(computeCacheScoreFields(makeInput({ cacheTtl: "" })).cacheTtlBucket).toBe("5m");
  });

  it("prefers matchedFp over tip for the key while tokens still follow the tip", () => {
    const result = computeCacheScoreFields(
      makeInput({ affinity: makeAffinity({ matchedFp: "matchedfp" }) })
    );
    expect(result.cacheCompatibilityKey).toBe("k42:matchedfp");
    expect(result.theoreticalCacheTokens).toBe(25);
  });

  it("falls back from tip to sys when the tail is empty", () => {
    const affinity = makeAffinity({ chain: { sys: boundary(0, "sysfp", 41), tail: [] } });
    const result = computeCacheScoreFields(makeInput({ affinity }));
    expect(result.cacheCompatibilityKey).toBe("k42:sysfp");
    // tip falls back to sys: floor(41 / 4)
    expect(result.theoreticalCacheTokens).toBe(10);
  });
});
