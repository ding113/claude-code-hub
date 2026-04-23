import { describe, expect, it } from "vitest";
import {
  assertPublicStatusRequestRowCap,
  buildPublicStatusPayloadFromRequests,
  MAX_PUBLIC_STATUS_REQUEST_ROWS,
} from "@/lib/public-status/aggregation";

describe("public-status aggregation", () => {
  it("aggregates request history into group/model timeline payload", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "Primary fleet",
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 1,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1000,
          ttfbMs: 200,
          outputTokens: 80,
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 2,
          createdAt: "2026-04-21T10:40:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1400,
          ttfbMs: 300,
          outputTokens: 60,
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "retry_failed",
              statusCode: 500,
            },
          ],
        },
      ],
    });

    expect(result.coveredFrom).toBe("2026-04-21T10:00:00.000Z");
    expect(result.coveredTo).toBe("2026-04-21T11:00:00.000Z");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.models[0]?.timeline).toHaveLength(4);
    expect(result.groups[0]?.models[0]?.latestState).toBe("failed");
  });

  it("counts failures that have no statusCode but do have failure reason/context", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: null,
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 3,
          createdAt: "2026-04-21T10:25:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1500,
          ttfbMs: 500,
          outputTokens: null,
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "system_error",
              statusCode: null,
              errorMessage: "fetch failed",
            },
          ],
        },
      ],
    });

    expect(result.groups[0]?.models[0]?.latestState).toBe("failed");
    expect(result.groups[0]?.models[0]?.timeline.some((bucket) => bucket.sampleCount > 0)).toBe(
      true
    );
  });

  it("guards rebuilds with an explicit request-row cap", () => {
    expect(() => assertPublicStatusRequestRowCap(MAX_PUBLIC_STATUS_REQUEST_ROWS)).not.toThrow();
    expect(() => assertPublicStatusRequestRowCap(MAX_PUBLIC_STATUS_REQUEST_ROWS + 1)).toThrow(
      "PUBLIC_STATUS_REQUEST_ROW_CAP_EXCEEDED"
    );
  });

  it("excludes non-upstream failures from availability counts", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: null,
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 4,
          createdAt: "2026-04-21T10:25:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "client_error_non_retryable",
              statusCode: 499,
              matchedRule: {
                ruleId: 1,
                pattern: "blocked",
                matchType: "contains",
                category: "content_filter",
                hasOverrideResponse: false,
                hasOverrideStatusCode: false,
              },
            },
          ],
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.availabilityPct).toBeNull();
    expect(model?.timeline.every((bucket) => bucket.sampleCount === 0)).toBe(true);
  });

  it("uses originalModel before redirected model for grouping", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: null,
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1-original",
              label: "GPT-4.1 Original",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 5,
          createdAt: "2026-04-21T10:30:00.000Z",
          model: "redirected-model",
          originalModel: "gpt-4.1-original",
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.availabilityPct).toBe(100);
    expect(model?.timeline.some((bucket) => bucket.sampleCount === 1)).toBe(true);
  });

  it("ignores informational chain items before an excluded terminal event", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: null,
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 6,
          createdAt: "2026-04-21T10:35:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "initial_selection",
            },
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "client_abort",
              statusCode: 499,
            },
          ],
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.availabilityPct).toBeNull();
    expect(model?.latestState).toBe("no_data");
  });
});
