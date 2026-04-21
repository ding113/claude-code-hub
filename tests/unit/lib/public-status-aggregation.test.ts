import { describe, expect, it } from "vitest";
import {
  applyBoundedGapFill,
  buildPublicStatusSnapshotFromRequests,
  computeTokensPerSecond,
  isExcludedFromPublicStatusFailure,
} from "@/lib/public-status/aggregation";

describe("public status aggregation helpers", () => {
  it("derives TPS from output tokens and generation window after TTFB", () => {
    expect(
      computeTokensPerSecond({
        outputTokens: 50,
        durationMs: 7000,
        ttfbMs: 2000,
      })
    ).toBe(10);

    expect(
      computeTokensPerSecond({
        outputTokens: 10,
        durationMs: 1000,
        ttfbMs: 1200,
      })
    ).toBeNull();
  });

  it("treats matched error rules, 499, 404 fallback, concurrent limit, no-provider and hedge losers as excluded", () => {
    expect(
      isExcludedFromPublicStatusFailure({
        statusCode: 499,
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        statusCode: 404,
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        statusCode: 404,
        reason: "resource_not_found",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        reason: "concurrent_limit_failed",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        reason: "hedge_loser_cancelled",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        reason: "client_error_non_retryable",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        errorMessage: "No available provider after all fallbacks",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        errorMessage: "Rate limit exceeded by upstream provider",
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        matchedRule: {
          ruleId: 1,
          pattern: "foo",
          matchType: "regex",
          category: "client_input",
          hasOverrideResponse: true,
          hasOverrideStatusCode: true,
        },
      })
    ).toBe(true);

    expect(
      isExcludedFromPublicStatusFailure({
        statusCode: 500,
        reason: "retry_failed",
      })
    ).toBe(false);
  });

  it("fills internal gaps by carrying the previous known state forward", () => {
    expect(
      applyBoundedGapFill({
        timeline: ["operational", null, "operational"],
        bucketMinutes: 5,
      })
    ).toEqual(["operational", "operational", "operational"]);

    expect(
      applyBoundedGapFill({
        timeline: ["operational", null, "failed"],
        bucketMinutes: 5,
      })
    ).toEqual(["operational", "operational", "failed"]);

    expect(
      applyBoundedGapFill({
        timeline: ["failed", null, null, null, "failed"],
        bucketMinutes: 5,
      })
    ).toEqual(["failed", "failed", "failed", "failed", "failed"]);

    expect(
      applyBoundedGapFill({
        timeline: [null, null, "operational", null],
        bucketMinutes: 5,
      })
    ).toEqual([null, null, "operational", null]);
  });
});

describe("buildPublicStatusSnapshotFromRequests", () => {
  it("attributes fallback failure to the tried group and success to the fallback winner group", () => {
    const snapshot = buildPublicStatusSnapshotFromRequests({
      windowHours: 1,
      bucketMinutes: 5,
      now: "2026-04-21T01:00:00.000Z",
      groups: [
        { groupName: "alpha", displayName: "Alpha", modelIds: ["gpt-4.1"] },
        { groupName: "beta", displayName: "Beta", modelIds: ["gpt-4.1"] },
      ],
      requests: [
        {
          id: 1,
          createdAt: "2026-04-21T00:55:00.000Z",
          originalModel: "gpt-4.1",
          model: "gpt-4.1",
          durationMs: 2100,
          ttfbMs: 100,
          outputTokens: 20,
          providerChain: [
            {
              id: 101,
              name: "alpha-1",
              groupTag: "alpha",
              providerType: "openai-compatible",
              reason: "retry_failed",
              statusCode: 500,
            },
            {
              id: 202,
              name: "beta-1",
              groupTag: "beta",
              providerType: "openai-compatible",
              reason: "retry_success",
              statusCode: 200,
            },
          ],
        },
      ],
    });

    const alpha = snapshot.groups.find((group) => group.groupName === "alpha");
    const beta = snapshot.groups.find((group) => group.groupName === "beta");

    expect(alpha?.models[0]?.latestState).toBe("failed");
    expect(beta?.models[0]?.latestState).toBe("operational");
    expect(alpha?.models[0]?.availabilityPct).toBe(0);
    expect(beta?.models[0]?.availabilityPct).toBe(100);
  });

  it("deduplicates repeated attempts within the same group for one request and lets success win", () => {
    const snapshot = buildPublicStatusSnapshotFromRequests({
      windowHours: 1,
      bucketMinutes: 5,
      now: "2026-04-21T01:00:00.000Z",
      groups: [{ groupName: "alpha", displayName: "Alpha", modelIds: ["gpt-4.1"] }],
      requests: [
        {
          id: 2,
          createdAt: "2026-04-21T00:55:00.000Z",
          originalModel: "gpt-4.1",
          model: "gpt-4.1",
          durationMs: 5000,
          ttfbMs: 1000,
          outputTokens: 40,
          providerChain: [
            {
              id: 111,
              name: "alpha-a",
              groupTag: "alpha",
              providerType: "openai-compatible",
              reason: "retry_failed",
              statusCode: 500,
            },
            {
              id: 112,
              name: "alpha-b",
              groupTag: "alpha,alpha",
              providerType: "openai-compatible",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      ],
    });

    const alphaModel = snapshot.groups[0]?.models[0];
    const latestBucket = alphaModel?.timeline.at(-1);

    expect(alphaModel?.latestState).toBe("operational");
    expect(alphaModel?.availabilityPct).toBe(100);
    expect(latestBucket?.sampleCount).toBe(1);
  });
});
