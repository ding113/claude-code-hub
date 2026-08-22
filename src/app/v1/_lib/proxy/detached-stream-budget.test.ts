import { describe, expect, it } from "vitest";
import {
  DetachedStreamBudget,
  resolveDetachedStreamBudgetLimits,
} from "@/app/v1/_lib/proxy/detached-stream-budget";

function createBudget(
  overrides: Partial<ReturnType<DetachedStreamBudget["snapshot"]>["limits"]> = {}
) {
  return new DetachedStreamBudget(() => ({
    maxConcurrency: 4,
    maxReservedBytes: 1024,
    meteringReserveBytes: 256,
    ...overrides,
  }));
}

describe("DetachedStreamBudget", () => {
  it("enforces concurrency and releases weighted leases idempotently", () => {
    const budget = createBudget({ maxConcurrency: 1 });
    const first = budget.tryAcquire("metering", 256);
    expect(first.acquired).toBe(true);
    expect(budget.tryAcquire("metering", 256)).toEqual({
      acquired: false,
      reason: "concurrency_exhausted",
    });

    if (!first.acquired) throw new Error("expected first lease");
    first.lease.release();
    first.lease.release();
    expect(budget.snapshot()).toMatchObject({
      activeStreams: 0,
      reservedBytes: 0,
      activeByKind: { metering: 0, replay: 0 },
      reservedByKind: { metering: 0, replay: 0 },
    });
  });

  it("reserves headroom for metering when admitting Replay owners", () => {
    const budget = createBudget();
    const replay = budget.tryAcquire("replay", 768);
    expect(replay.acquired).toBe(true);
    expect(budget.tryAcquire("replay", 1)).toEqual({
      acquired: false,
      reason: "metering_reserve",
    });
    expect(budget.tryAcquire("metering", 256).acquired).toBe(true);
  });

  it("enforces the aggregate memory budget across lease kinds", () => {
    const budget = createBudget({ meteringReserveBytes: 0 });
    expect(budget.tryAcquire("replay", 768).acquired).toBe(true);
    expect(budget.tryAcquire("metering", 257)).toEqual({
      acquired: false,
      reason: "memory_budget_exhausted",
    });
  });

  it("tracks Replay and metering reservations independently", () => {
    const budget = createBudget({ meteringReserveBytes: 0 });
    expect(budget.tryAcquire("replay", 512).acquired).toBe(true);
    expect(budget.tryAcquire("metering", 256).acquired).toBe(true);
    expect(budget.snapshot()).toMatchObject({
      activeStreams: 2,
      reservedBytes: 768,
      activeByKind: { metering: 1, replay: 1 },
      reservedByKind: { metering: 256, replay: 512 },
    });
  });

  it("rejects invalid reservations without mutating state", () => {
    const budget = createBudget();
    expect(() => budget.tryAcquire("metering", 0)).toThrow(RangeError);
    expect(budget.snapshot().activeStreams).toBe(0);
  });

  it("uses conservative defaults when environment parsing fails", () => {
    expect(
      resolveDetachedStreamBudgetLimits(() => {
        throw new Error("invalid environment");
      })
    ).toEqual({
      maxConcurrency: 64,
      maxReservedBytes: 64 * 1024 * 1024,
      meteringReserveBytes: 16 * 1024 * 1024,
    });
  });
});
