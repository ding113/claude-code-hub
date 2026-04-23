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

  it("counts null or blank provider-chain group tags inside the default group", () => {
    const result = buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "default",
          publicGroupSlug: "platform",
          displayName: "Platform",
          explanatoryCopy: "Default group",
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
          id: 7,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 71,
              name: "provider-1",
              groupTag: null,
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 8,
          createdAt: "2026-04-21T10:20:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 81,
              name: "provider-2",
              groupTag: "",
              reason: "retry_failed",
              statusCode: 500,
            },
          ],
        },
        {
          id: 9,
          createdAt: "2026-04-21T10:30:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 91,
              name: "provider-3",
              groupTag: "default",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 10,
          createdAt: "2026-04-21T10:45:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: null,
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.timeline.reduce((sum, bucket) => sum + bucket.sampleCount, 0)).toBe(3);
    expect(model?.latestState).toBe("operational");
  });

  it("does not leak ungrouped traffic into named groups", () => {
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
          id: 11,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 111,
              name: "provider-1",
              groupTag: null,
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 12,
          createdAt: "2026-04-21T10:25:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 121,
              name: "provider-2",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.timeline.reduce((sum, bucket) => sum + bucket.sampleCount, 0)).toBe(1);
    expect(model?.latestState).toBe("operational");
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
