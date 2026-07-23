import { describe, expect, it } from "vitest";
import { inferPhase } from "./live-chain-store";
import type { ProviderChainItem } from "@/types/message";
import type { RoutingTraceEventV1, RoutingTraceV1 } from "@/types/routing-trace";

// Note: writeLiveChain/readLiveChain/readLiveChainBatch/deleteLiveChain
// require "server-only" + Redis, so they are tested via integration tests.
// This file tests the pure logic function: inferPhase.

function makeChainItem(overrides: Partial<ProviderChainItem> = {}): ProviderChainItem {
  return { id: 1, name: "provider-a", timestamp: Date.now(), ...overrides };
}

function makeDiscoveryTrace(
  event: RoutingTraceEventV1,
  overrides: Partial<RoutingTraceV1> = {}
): RoutingTraceV1 {
  return {
    version: 1,
    mode: "discovery",
    startedAt: 100,
    updatedAt: 200,
    discoveryEnabled: true,
    eligible: true,
    events: [event],
    ...overrides,
  };
}

describe("inferPhase", () => {
  it('returns "queued" for empty chain', () => {
    expect(inferPhase([])).toBe("queued");
  });

  it('returns "provider_selected" for initial_selection', () => {
    expect(inferPhase([makeChainItem({ reason: "initial_selection" })])).toBe("provider_selected");
  });

  it('returns "session_reused" for session_reuse', () => {
    expect(inferPhase([makeChainItem({ reason: "session_reuse" })])).toBe("session_reused");
  });

  it('returns "retrying" for retry_failed', () => {
    expect(
      inferPhase([
        makeChainItem({ reason: "initial_selection" }),
        makeChainItem({ reason: "retry_failed" }),
      ])
    ).toBe("retrying");
  });

  it('returns "retrying" for system_error', () => {
    expect(inferPhase([makeChainItem({ reason: "system_error" })])).toBe("retrying");
  });

  it('returns "retrying" for resource_not_found', () => {
    expect(inferPhase([makeChainItem({ reason: "resource_not_found" })])).toBe("retrying");
  });

  it('returns "hedge_racing" for hedge_triggered', () => {
    expect(inferPhase([makeChainItem({ reason: "hedge_triggered" })])).toBe("hedge_racing");
  });

  it('returns "hedge_racing" for hedge_launched', () => {
    expect(inferPhase([makeChainItem({ reason: "hedge_launched" })])).toBe("hedge_racing");
  });

  it('returns "hedge_resolved" for hedge_winner', () => {
    expect(
      inferPhase([
        makeChainItem({ reason: "hedge_triggered" }),
        makeChainItem({ reason: "hedge_winner" }),
      ])
    ).toBe("hedge_resolved");
  });

  it('returns "hedge_resolved" for hedge_loser_cancelled', () => {
    expect(inferPhase([makeChainItem({ reason: "hedge_loser_cancelled" })])).toBe("hedge_resolved");
  });

  it('returns "streaming" for request_success', () => {
    expect(
      inferPhase([
        makeChainItem({ reason: "initial_selection" }),
        makeChainItem({ reason: "request_success" }),
      ])
    ).toBe("streaming");
  });

  it('returns "streaming" for retry_success', () => {
    expect(
      inferPhase([
        makeChainItem({ reason: "retry_failed" }),
        makeChainItem({ reason: "retry_success" }),
      ])
    ).toBe("streaming");
  });

  it('returns "aborted" for client_abort', () => {
    expect(inferPhase([makeChainItem({ reason: "client_abort" })])).toBe("aborted");
  });

  it('returns "forwarding" for unknown reasons', () => {
    expect(inferPhase([makeChainItem({ reason: undefined })])).toBe("forwarding");
  });

  it("uses last chain item to determine phase", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "retry_failed" }),
      makeChainItem({ reason: "request_success" }),
    ];
    expect(inferPhase(chain)).toBe("streaming");
  });

  it.each([
    ["sticky_probe_started", "discovery_sticky"],
    ["round_started", "discovery_racing"],
    ["attempt_started", "discovery_racing"],
    ["attempt_ready", "discovery_racing"],
    ["attempt_held", "discovery_racing"],
    ["attempt_finished", "discovery_racing"],
    ["sticky_timeout", "discovery_racing"],
    ["fallback_promoted", "discovery_fallback"],
    ["winner_committed", "streaming"],
    ["binding_finalized", "streaming"],
  ] as const)("derives %s Discovery events as %s", (type, expected) => {
    expect(inferPhase([], makeDiscoveryTrace({ type, at: 100, elapsedMs: 0 }))).toBe(expected);
  });

  it.each([
    ["success", "completed"],
    ["failed", "failed"],
    ["client_abort", "aborted"],
    ["deadline", "deadline"],
  ] as const)("derives Discovery terminal outcome %s as %s", (outcome, expected) => {
    expect(
      inferPhase(
        [],
        makeDiscoveryTrace(
          { type: "request_finished", at: 200, elapsedMs: 100, outcome },
          {
            summary: {
              outcome,
              statusCode: outcome === "success" ? 200 : 503,
              durationMs: 100,
              ttfbMs: null,
              attemptsPerRequest: 2,
              maxActiveAttempts: 2,
              rounds: 1,
              providerMs: 200,
              fallbackPromotions: 0,
              cancelFailures: 0,
              winnerOrigin: outcome === "success" ? "normal" : "none",
              winnerProviderId: outcome === "success" ? 1 : null,
              winnerRound: outcome === "success" ? 1 : null,
            },
          }
        )
      )
    ).toBe(expected);
  });

  it("keeps the terminal phase when binding finalization is appended later", () => {
    const trace = makeDiscoveryTrace(
      { type: "binding_finalized", at: 210, elapsedMs: 110 },
      {
        events: [
          { type: "request_finished", at: 200, elapsedMs: 100, outcome: "success" },
          { type: "binding_finalized", at: 210, elapsedMs: 110 },
        ],
        summary: {
          outcome: "success",
          statusCode: 200,
          durationMs: 100,
          ttfbMs: 20,
          attemptsPerRequest: 2,
          maxActiveAttempts: 2,
          rounds: 1,
          providerMs: 200,
          fallbackPromotions: 0,
          cancelFailures: 0,
          winnerOrigin: "normal",
          winnerProviderId: 1,
          winnerRound: 1,
        },
      }
    );
    expect(inferPhase([], trace)).toBe("completed");
  });

  it("keeps a first-byte winner streaming until request_finished exists", () => {
    const trace = makeDiscoveryTrace(
      { type: "winner_committed", at: 200, elapsedMs: 100 },
      {
        summary: {
          outcome: "success",
          statusCode: 200,
          durationMs: 100,
          ttfbMs: 20,
          attemptsPerRequest: 2,
          maxActiveAttempts: 2,
          rounds: 1,
          providerMs: 200,
          fallbackPromotions: 0,
          cancelFailures: 0,
          winnerOrigin: "normal",
          winnerProviderId: 1,
          winnerRound: 1,
        },
      }
    );
    expect(inferPhase([], trace)).toBe("streaming");
  });

  it("keeps legacy chain phase for a non-Discovery trace", () => {
    const trace = makeDiscoveryTrace(
      { type: "winner_committed", at: 200, elapsedMs: 100 },
      { mode: "legacy_serial", eligible: false }
    );
    expect(inferPhase([makeChainItem({ reason: "retry_failed" })], trace)).toBe("retrying");
  });
});
