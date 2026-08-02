import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupControl = vi.hoisted(() => ({
  runReplayCleanupTick: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/replay-cleanup", () => ({
  runReplayCleanupTick: cleanupControl.runReplayCleanupTick,
}));

import { startReplayCleanupScheduler } from "@/instrumentation";

describe("startReplayCleanupScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cleanupControl.runReplayCleanupTick.mockReset().mockResolvedValue({
      status: "completed",
      batches: 1,
      deleted: 0,
    });
    const state = globalThis as typeof globalThis & {
      __CCH_REPLAY_CLEANUP_STARTED__?: boolean;
      __CCH_REPLAY_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval>;
    };
    state.__CCH_REPLAY_CLEANUP_STARTED__ = false;
    state.__CCH_REPLAY_CLEANUP_INTERVAL_ID__ = undefined;
  });

  afterEach(() => {
    const state = globalThis as typeof globalThis & {
      __CCH_REPLAY_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval>;
    };
    if (state.__CCH_REPLAY_CLEANUP_INTERVAL_ID__) {
      clearInterval(state.__CCH_REPLAY_CLEANUP_INTERVAL_ID__);
    }
    vi.useRealTimers();
  });

  it("starts cleanup immediately and every ten minutes regardless of Replay enablement", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    await startReplayCleanupScheduler();
    await vi.runOnlyPendingTimersAsync();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    expect(cleanupControl.runReplayCleanupTick).toHaveBeenCalledTimes(2);
  });
});
