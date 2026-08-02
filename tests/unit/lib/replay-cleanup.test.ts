import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanupControl = vi.hoisted(() => ({
  cleanupExpired: vi.fn(),
  withAdvisoryLock: vi.fn(),
}));

vi.mock("@/app/v1/_lib/proxy/replay/replay-store", () => ({
  REPLAY_CLEANUP_BATCH_SIZE: 100,
  getReplayStore: () => ({ cleanupExpired: cleanupControl.cleanupExpired }),
}));

vi.mock("@/lib/migrate", () => ({
  withAdvisoryLock: cleanupControl.withAdvisoryLock,
}));

import { runReplayCleanupTick } from "@/lib/replay-cleanup";

describe("runReplayCleanupTick", () => {
  beforeEach(() => {
    cleanupControl.cleanupExpired.mockReset();
    cleanupControl.withAdvisoryLock.mockReset();
    cleanupControl.withAdvisoryLock.mockImplementation(
      async (_lockName: string, callback: () => Promise<unknown>) => ({
        ran: true,
        result: await callback(),
      })
    );
  });

  it("holds one advisory lock while deleting at most five batches", async () => {
    cleanupControl.cleanupExpired.mockResolvedValue(100);

    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "completed",
      batches: 5,
      deleted: 500,
    });

    expect(cleanupControl.withAdvisoryLock).toHaveBeenCalledWith(
      "claude-code-hub:replay-cleanup",
      expect.any(Function),
      { skipIfLocked: true }
    );
    expect(cleanupControl.cleanupExpired).toHaveBeenCalledTimes(5);
    const cutoffs = cleanupControl.cleanupExpired.mock.calls.map(([cutoff]) => cutoff);
    expect(cutoffs.every((cutoff) => cutoff === cutoffs[0])).toBe(true);
  });

  it("stops after a partial batch", async () => {
    cleanupControl.cleanupExpired.mockResolvedValue(42);

    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "completed",
      batches: 1,
      deleted: 42,
    });
    expect(cleanupControl.cleanupExpired).toHaveBeenCalledTimes(1);
  });

  it("skips database work when another Pod holds the advisory lock", async () => {
    cleanupControl.withAdvisoryLock.mockResolvedValue({ ran: false });

    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "skipped_locked",
      batches: 0,
      deleted: 0,
    });
    expect(cleanupControl.cleanupExpired).not.toHaveBeenCalled();
  });

  it("stops before starting another batch after the 30 second budget", async () => {
    cleanupControl.cleanupExpired.mockResolvedValue(100);
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);

    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "completed",
      batches: 1,
      deleted: 100,
    });
    now.mockRestore();
  });

  it("skips reentrant ticks in the same process", async () => {
    let releaseBatch: ((deleted: number) => void) | undefined;
    cleanupControl.cleanupExpired.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          releaseBatch = resolve;
        })
    );

    const first = runReplayCleanupTick();
    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "skipped_running",
      batches: 0,
      deleted: 0,
    });

    releaseBatch?.(0);
    await expect(first).resolves.toEqual({ status: "completed", batches: 1, deleted: 0 });
  });

  it("releases the in-process guard after a failed tick", async () => {
    cleanupControl.cleanupExpired.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(runReplayCleanupTick()).rejects.toThrow("database unavailable");

    cleanupControl.cleanupExpired.mockResolvedValueOnce(0);
    await expect(runReplayCleanupTick()).resolves.toEqual({
      status: "completed",
      batches: 1,
      deleted: 0,
    });
  });
});
