import { describe, expect, it } from "vitest";
import { shouldShowCostBadgeInCell } from "./provider-chain-display";
import type { ProviderChainItem } from "@/types/message";

function makeChainItem(overrides: Partial<ProviderChainItem> = {}): ProviderChainItem {
  return { id: 1, name: "provider-a", ...overrides };
}

describe("shouldShowCostBadgeInCell", () => {
  it("returns false when costMultiplier is null", () => {
    expect(shouldShowCostBadgeInCell([], null)).toBe(false);
  });

  it("returns false when costMultiplier is undefined", () => {
    expect(shouldShowCostBadgeInCell([], undefined)).toBe(false);
  });

  it("returns false when costMultiplier is 1", () => {
    expect(shouldShowCostBadgeInCell([], 1)).toBe(false);
  });

  it("returns false when costMultiplier is NaN", () => {
    expect(shouldShowCostBadgeInCell([], Number.NaN)).toBe(false);
  });

  it("returns false when costMultiplier is Infinity", () => {
    expect(shouldShowCostBadgeInCell([], Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("returns true for simple request (empty chain) with multiplier != 1", () => {
    expect(shouldShowCostBadgeInCell([], 1.5)).toBe(true);
    expect(shouldShowCostBadgeInCell(null, 0.8)).toBe(true);
    expect(shouldShowCostBadgeInCell(undefined, 2.0)).toBe(true);
  });

  it("returns true for single-request chain (no retries, no hedge)", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "request_success", statusCode: 200 }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 1.5)).toBe(true);
  });

  it("returns false when chain has retries", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "retry_failed", statusCode: 500 }),
      makeChainItem({ reason: "request_success", statusCode: 200 }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 1.5)).toBe(false);
  });

  it("returns false when chain has hedge race", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "hedge_triggered" }),
      makeChainItem({ reason: "hedge_launched" }),
      makeChainItem({ reason: "hedge_winner", statusCode: 200 }),
      makeChainItem({ reason: "hedge_loser_cancelled" }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 1.5)).toBe(false);
  });

  it("returns false for mixed retry + hedge chain", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "retry_failed" }),
      makeChainItem({ reason: "hedge_triggered" }),
      makeChainItem({ reason: "hedge_winner", statusCode: 200 }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 2.0)).toBe(false);
  });

  it("returns true for session_reuse (no retry, no hedge)", () => {
    const chain = [
      makeChainItem({ reason: "session_reuse" }),
      makeChainItem({ reason: "request_success", statusCode: 200 }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 0.5)).toBe(true);
  });

  it("returns true for multiplier < 1 (discount)", () => {
    const chain = [
      makeChainItem({ reason: "initial_selection" }),
      makeChainItem({ reason: "request_success", statusCode: 200 }),
    ];
    expect(shouldShowCostBadgeInCell(chain, 0.5)).toBe(true);
  });
});
