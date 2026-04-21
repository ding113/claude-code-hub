import { describe, expect, it } from "vitest";
import { buildPublicStatusPayloadFromRequests } from "@/lib/public-status/aggregation";

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
});
