import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCoordinator } from "../../server-lib/memory-coordinator";
import { LocalCapacityError, MemoryGovernor } from "../../server-lib/memory-governor";

afterEach(() => vi.useRealTimers());

function remoteGovernor(capacity = 64 * 1024 ** 2) {
  const coordinator = createMemoryCoordinator({
    env: { CCH_MEMORY_BUDGET_BYTES: String(capacity) },
    readSnapshot: () => ({ availableRamBytes: 1024 ** 3, availableSwapBytes: 0 }),
  });
  const worker = Object.assign(new EventEmitter(), {
    send: (message: unknown) => queueMicrotask(() => child.emit("message", message)),
  });
  const child = Object.assign(new EventEmitter(), {
    env: {},
    connected: true,
    send: (message: unknown, callback?: () => void) => {
      queueMicrotask(() => worker.emit("message", message));
      callback?.();
    },
  });
  coordinator.attach(worker);
  coordinator.resetBaseline();
  const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });
  return {
    governor,
    coordinator,
    close() {
      governor.sample();
      child.connected = false;
      child.emit("disconnect");
      worker.emit("exit");
    },
  };
}

describe("remote memory growth", () => {
  it("shares in-flight credits and renegotiates when another lease consumes the grant", async () => {
    const { governor, coordinator, close } = remoteGovernor();
    const leases = await Promise.all([governor.acquire(128 * 1024), governor.acquire(128 * 1024)]);
    try {
      expect(governor.snapshot().limitBytes).toBe(1024 ** 2);
      await expect(
        Promise.all(leases.map((lease) => lease.tryGrowAsync(3 * 1024 ** 2)))
      ).resolves.toEqual([true, true]);
      expect(governor.snapshot()).toMatchObject({ usedBytes: 6 * 1024 ** 2, waiting: 0 });
      expect(coordinator.snapshot().grantedBytes).toBeGreaterThanOrEqual(6 * 1024 ** 2);
    } finally {
      for (const lease of leases) lease.release();
      close();
    }
    expect(governor.snapshot().usedBytes).toBe(0);
    expect(coordinator.snapshot().grantedBytes).toBe(0);
  });

  it("returns false immediately after an authoritative partial grant", async () => {
    const { governor, close } = remoteGovernor(1536 * 1024);
    const lease = await governor.acquire(128 * 1024);
    try {
      await expect(lease.tryGrowAsync(2 * 1024 ** 2)).resolves.toBe(false);
      expect(governor.snapshot()).toMatchObject({ usedBytes: 128 * 1024, waiting: 0 });
      await expect(lease.tryGrowAsync(512 * 1024)).resolves.toBe(true);
    } finally {
      lease.release();
      close();
    }
  });

  it.each(["abort", "timeout", "disconnect", "released"])(
    "settles an in-flight growth on %s without changing the existing lease",
    async (mode) => {
      vi.useFakeTimers();
      const child = Object.assign(new EventEmitter(), {
        env: {},
        connected: true,
        send: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
      });
      const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });
      governor.credits = 1024 ** 2;
      const lease = governor.tryLease(128 * 1024)!;
      const controller = new AbortController();
      const growth = lease.tryGrowAsync(2 * 1024 ** 2, controller.signal);
      try {
        if (mode === "abort") {
          const rejected = expect(growth).rejects.toThrow("client closed");
          controller.abort(new Error("client closed"));
          await rejected;
        } else if (mode === "timeout") {
          const rejected = expect(growth).rejects.toBeInstanceOf(LocalCapacityError);
          await vi.advanceTimersByTimeAsync(20000);
          await rejected;
        } else {
          if (mode === "released") lease.release();
          child.connected = false;
          child.emit("disconnect");
          await expect(growth).resolves.toBe(false);
        }
        expect(governor.snapshot().usedBytes).toBe(mode === "released" ? 0 : 128 * 1024);
      } finally {
        lease.release();
        child.connected = false;
        child.emit("disconnect");
      }
    }
  );

  it("does not queue on local exhaustion and honors cancellation before an available growth", async () => {
    const governor = new MemoryGovernor({ limit: 1024, remote: false, monitor: false });
    const lease = governor.tryLease(512)!;
    await expect(lease.tryGrowAsync(2048)).resolves.toBe(false);
    await expect(lease.tryGrowAsync(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(lease.tryGrowAsync(1024, AbortSignal.abort(new Error("closed")))).rejects.toThrow(
      "closed"
    );
    expect(governor.snapshot().usedBytes).toBe(512);
    lease.release();
    await expect(lease.tryGrowAsync(1024)).resolves.toBe(false);
  });
});
