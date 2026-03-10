import { describe, expect, it } from "vitest";
import { inferPhase } from "./live-chain-store";
import type { ProviderChainItem } from "@/types/message";

// Note: writeLiveChain/readLiveChain/readLiveChainBatch/deleteLiveChain
// require "server-only" + Redis, so they are tested via integration tests.
// This file tests the pure logic function: inferPhase.

function makeChainItem(overrides: Partial<ProviderChainItem> = {}): ProviderChainItem {
  return { id: 1, name: "provider-a", timestamp: Date.now(), ...overrides };
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
});
