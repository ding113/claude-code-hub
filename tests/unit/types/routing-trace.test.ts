import { describe, expect, it } from "vitest";
import { normalizeRoutingTrace, ROUTING_TRACE_MAX_EVENTS } from "@/types/routing-trace";

describe("normalizeRoutingTrace", () => {
  it("未知版本或缺少必要字段时返回 null", () => {
    expect(normalizeRoutingTrace(null)).toBeNull();
    expect(normalizeRoutingTrace({ version: 2, events: [] })).toBeNull();
    expect(
      normalizeRoutingTrace({
        version: 1,
        mode: "discovery",
        startedAt: 1,
        updatedAt: 2,
        discoveryEnabled: true,
        eligible: true,
      })
    ).toBeNull();
  });

  it("只保留事件白名单字段并剔除敏感扩展数据", () => {
    const trace = normalizeRoutingTrace({
      version: 1,
      mode: "discovery",
      startedAt: 1,
      updatedAt: 2,
      discoveryEnabled: true,
      eligible: true,
      config: {
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10_000,
        stickySlaMs: 20_000,
        racingTotalTimeoutMs: 60_000,
        stickyTimeoutCooldownMs: 300_000,
        apiKey: "secret",
      },
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 5_000,
        ttfbMs: 1_000,
        attemptsPerRequest: 2,
        maxActiveAttempts: 2,
        rounds: 1,
        providerMs: 3_000,
        fallbackPromotions: 0,
        cancelFailures: 0,
        winnerOrigin: "normal",
        winnerProviderId: 7,
        winnerRound: 1,
        rawErrorBody: "secret",
      },
      events: [
        {
          type: "attempt_started",
          at: 2,
          elapsedMs: 1,
          attemptId: "attempt-1",
          attemptKind: "normal",
          provider: {
            id: 7,
            name: "Provider 7",
            priority: 1,
            endpointUrl: "secret",
          },
          rawErrorBody: "secret",
          apiKey: "secret",
        },
      ],
    });

    expect(trace?.events).toEqual([
      {
        type: "attempt_started",
        at: 2,
        elapsedMs: 1,
        attemptId: "attempt-1",
        attemptKind: "normal",
        provider: { id: 7, name: "Provider 7", priority: 1 },
      },
    ]);
    expect(trace?.config).not.toHaveProperty("apiKey");
    expect(trace?.summary).not.toHaveProperty("rawErrorBody");
  });

  it("限制事件数量并标记 truncated", () => {
    const events = Array.from({ length: ROUTING_TRACE_MAX_EVENTS + 1 }, (_, index) => ({
      type: "round_started",
      at: index,
      elapsedMs: index,
      round: index + 1,
    }));

    const trace = normalizeRoutingTrace({
      version: 1,
      mode: "discovery",
      startedAt: 0,
      updatedAt: 1,
      discoveryEnabled: true,
      eligible: true,
      events,
    });

    expect(trace?.events).toHaveLength(ROUTING_TRACE_MAX_EVENTS);
    expect(trace?.truncated).toBe(true);
  });
});
