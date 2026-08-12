import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupControl = vi.hoisted(() => ({
  runReplayCleanupTick: vi.fn(),
}));

const loggerControl = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: loggerControl.info,
    warn: loggerControl.warn,
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
    loggerControl.info.mockReset();
    loggerControl.warn.mockReset();
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

  it("logs the wrapped Postgres cause when a cleanup tick fails", async () => {
    const cause = Object.assign(new Error("canceling statement due to lock timeout"), {
      code: "55P03",
    });
    cleanupControl.runReplayCleanupTick.mockRejectedValueOnce(new Error("Failed query", { cause }));

    await startReplayCleanupScheduler();
    await vi.runOnlyPendingTimersAsync();

    expect(loggerControl.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Failed query",
        errorName: "Error",
        errorCause: "canceling statement due to lock timeout",
        errorCauseName: "Error",
        errorCauseCode: "55P03",
      }),
      "[Instrumentation] Replay cleanup tick failed"
    );
  });

  it("logs batch and deletion progress when a cleanup tick removes rows", async () => {
    cleanupControl.runReplayCleanupTick.mockResolvedValue({
      status: "completed",
      batches: 2,
      deleted: 150,
    });

    await startReplayCleanupScheduler();
    await vi.runOnlyPendingTimersAsync();

    expect(loggerControl.info).toHaveBeenCalledWith(
      { status: "completed", batches: 2, deleted: 150 },
      "[Instrumentation] Replay cleanup tick completed"
    );
  });
});
