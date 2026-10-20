// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDiscoveryLeaseHeartbeat } from "@/app/v1/_lib/proxy/discovery-lease-heartbeat";

describe("Discovery precommit lease heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews across a wait longer than the original TTL and stops at handoff", async () => {
    const renew = vi.fn(async () => true);
    const onLost = vi.fn();
    const stop = startDiscoveryLeaseHeartbeat({ ttlMs: 1000, renew, onLost });
    await vi.advanceTimersByTimeAsync(3500);
    expect(renew.mock.calls.length).toBeGreaterThan(3);
    expect(onLost).not.toHaveBeenCalled();
    stop();
    const calls = renew.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(renew).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loses ownership within the TTL even if Redis renewal never settles", async () => {
    const renew = vi.fn(() => new Promise<boolean>(() => {}));
    const onLost = vi.fn();
    startDiscoveryLeaseHeartbeat({ ttlMs: 1000, renew, onLost });
    await vi.advanceTimersByTimeAsync(1000);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a renewal rejection arriving after request cancellation", async () => {
    const pending = Promise.withResolvers<boolean>();
    const onLost = vi.fn();
    const stop = startDiscoveryLeaseHeartbeat({
      ttlMs: 1000,
      renew: () => pending.promise,
      onLost,
    });
    await vi.advanceTimersByTimeAsync(334);
    stop();
    pending.reject(new Error("late Redis error"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(onLost).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
