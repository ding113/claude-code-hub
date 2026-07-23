import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe.sequential("lifecycle/shutdown", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
    delete (globalThis as unknown as { __ASYNC_TASK_MANAGER__?: unknown }).__ASYNC_TASK_MANAGER__;
    delete (globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__?: unknown })
      .__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__;
    delete (globalThis as unknown as { __CCH_API_KEY_VF_SYNC_CLEANUP__?: unknown })
      .__CCH_API_KEY_VF_SYNC_CLEANUP__;
    delete (globalThis as unknown as { __CCH_STOP_BACKGROUND_QUEUES__?: unknown })
      .__CCH_STOP_BACKGROUND_QUEUES__;
    delete (globalThis as unknown as { __CCH_STOP_ROUTING_TRACE_OUTBOX__?: unknown })
      .__CCH_STOP_ROUTING_TRACE_OUTBOX__;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete (globalThis as unknown as { __ASYNC_TASK_MANAGER__?: unknown }).__ASYNC_TASK_MANAGER__;
    delete (globalThis as unknown as { __CCH_STOP_BACKGROUND_QUEUES__?: unknown })
      .__CCH_STOP_BACKGROUND_QUEUES__;
    delete (globalThis as unknown as { __CCH_STOP_ROUTING_TRACE_OUTBOX__?: unknown })
      .__CCH_STOP_ROUTING_TRACE_OUTBOX__;
  });

  it("markShuttingDown flips isShuttingDown idempotently", async () => {
    const { markShuttingDown, isShuttingDown, __resetShutdownStateForTests } = await import(
      "@/lib/lifecycle/shutdown"
    );
    __resetShutdownStateForTests();

    expect(isShuttingDown()).toBe(false);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });

  it("bindLifecycleGlobals attaches once and re-binding is a no-op", async () => {
    const { bindLifecycleGlobals } = await import("@/lib/lifecycle/shutdown");

    bindLifecycleGlobals();
    const first = (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
    expect(first).toBeDefined();

    bindLifecycleGlobals();
    const second = (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
    expect(second).toBe(first);
  });

  it("runApplicationCleanup invokes staged modules and survives one non-critical step throwing", async () => {
    const stopCache = vi.fn();
    const stopProbe = vi.fn(() => {
      throw new Error("simulated probe scheduler shutdown failure");
    });
    const stopPublicStatus = vi.fn(async () => {});
    const stopProbeLog = vi.fn();
    const shutdownTasks = vi.fn(async () => {});
    const stopWriteBuffer = vi.fn(async () => {});
    const shutdownLf = vi.fn(async () => {});
    const closeRedis = vi.fn(async () => {});

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: stopCache }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: stopProbe,
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: stopPublicStatus,
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: stopProbeLog,
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: shutdownTasks }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: stopWriteBuffer,
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: shutdownLf }));
    vi.doMock("@/lib/redis", () => ({ closeRedis }));

    const cleanupSpy = vi.fn();
    (
      globalThis as unknown as { __CCH_API_KEY_VF_SYNC_CLEANUP__?: () => void }
    ).__CCH_API_KEY_VF_SYNC_CLEANUP__ = cleanupSpy;

    const intervalId = setInterval(() => {}, 60_000);
    (
      globalThis as unknown as {
        __CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__?: ReturnType<typeof setInterval>;
      }
    ).__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__ = intervalId;
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");

    await runApplicationCleanup("SIGTERM", { totalTimeoutMs: 5_000, perStepTimeoutMs: 500 });

    expect(stopCache).toHaveBeenCalled();
    expect(stopProbe).toHaveBeenCalled();
    expect(stopPublicStatus).toHaveBeenCalled();
    expect(stopProbeLog).toHaveBeenCalled();
    expect(shutdownTasks).toHaveBeenCalled();
    expect(stopWriteBuffer).toHaveBeenCalled();
    expect(shutdownLf).toHaveBeenCalled();
    expect(closeRedis).toHaveBeenCalled();
    expect(cleanupSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });

  it("waits for scheduler quiescence after the warning threshold before closing resources", async () => {
    let releaseScheduler!: () => void;
    const schedulerStopped = new Promise<void>((resolve) => {
      releaseScheduler = resolve;
    });
    const closeDbPools = vi.fn(async () => {});
    const closeRedis = vi.fn(async () => {});

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: () => schedulerStopped,
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: async () => {},
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: async () => {} }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: async () => {},
    }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 5_000,
      perStepTimeoutMs: 20,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closeDbPools).not.toHaveBeenCalled();
    expect(closeRedis).not.toHaveBeenCalled();

    releaseScheduler();
    await cleanup;

    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
  });

  it("runApplicationCleanup returns within totalTimeoutMs even if one step hangs", async () => {
    let releaseHang: () => void = () => {};
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: () => {},
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: () => {},
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: () => {} }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: async () => {},
    }));
    // The hanging step
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => hang }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    const started = Date.now();
    await runApplicationCleanup("SIGTERM", { totalTimeoutMs: 300, perStepTimeoutMs: 100 });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
    releaseHang();
  });

  it("runApplicationCleanup abort 后等待所有 async task settled 再启动 writer", async () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doUnmock("@/lib/async-task-manager");

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: () => {},
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: () => {},
    }));

    const writerStarted = vi.fn();
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: async () => {
        writerStarted();
      },
    }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools: async () => {} }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstAborted = new Promise<void>((resolve) => {
      firstController.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    const secondAborted = new Promise<void>((resolve) => {
      secondController.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    AsyncTaskManager.register("shutdown-first", () => first, {
      abortController: firstController,
    });
    AsyncTaskManager.register("shutdown-second", () => second, {
      abortController: secondController,
    });

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 5_000,
      perStepTimeoutMs: 20,
    });
    await Promise.all([firstAborted, secondAborted]);

    expect(firstController.signal.aborted).toBe(true);
    expect(secondController.signal.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writerStarted).not.toHaveBeenCalled();

    resolveFirst();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(writerStarted).not.toHaveBeenCalled();

    resolveSecond();
    await cleanup;

    expect(writerStarted).toHaveBeenCalledTimes(1);
  });

  it("stops outbox ticks before writer shutdown but defers replay join until after writer", async () => {
    let releaseReplay!: () => void;
    const replaySettled = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const stopOutbox = vi.fn(async (options?: { wait?: boolean }) => {
      if (options?.wait !== false) await replaySettled;
    });
    const stopWriter = vi.fn(async () => {});
    const closeDbPools = vi.fn(async () => {});

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    (
      globalThis as unknown as {
        __CCH_STOP_ROUTING_TRACE_OUTBOX__?: typeof stopOutbox;
      }
    ).__CCH_STOP_ROUTING_TRACE_OUTBOX__ = stopOutbox;
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: async () => {},
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: async () => {},
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: async () => {} }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: stopWriter,
    }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 5_000,
      perStepTimeoutMs: 500,
    });

    await vi.waitFor(() => expect(stopWriter).toHaveBeenCalledOnce());
    expect(stopOutbox).toHaveBeenNthCalledWith(1, { wait: false });
    expect(stopOutbox).toHaveBeenNthCalledWith(2, { wait: true, maxWaitMs: 500 });
    expect(closeDbPools).not.toHaveBeenCalled();

    releaseReplay();
    await cleanup;
    expect(closeDbPools).toHaveBeenCalledOnce();
  });

  it("continues critical cleanup after background queue shutdown fails", async () => {
    const queueError = new Error("queue stop failed");
    const shutdownTasks = vi.fn(async () => {});
    const stopWriteBuffer = vi.fn(async () => {});
    const closeDbPools = vi.fn(async () => {});
    const shutdownLangfuse = vi.fn(async () => {});
    const closeRedis = vi.fn(async () => {});

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: () => {},
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: () => {},
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: shutdownTasks }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: stopWriteBuffer,
    }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse }));
    vi.doMock("@/lib/redis", () => ({ closeRedis }));
    (
      globalThis as unknown as { __CCH_STOP_BACKGROUND_QUEUES__?: () => Promise<void> }
    ).__CCH_STOP_BACKGROUND_QUEUES__ = vi.fn().mockRejectedValue(queueError);

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    let thrown: unknown;
    try {
      await runApplicationCleanup("SIGTERM", { totalTimeoutMs: 5_000, perStepTimeoutMs: 100 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toContain(queueError);
    expect(shutdownTasks).toHaveBeenCalledOnce();
    expect(stopWriteBuffer).toHaveBeenCalledOnce();
    expect(closeDbPools).toHaveBeenCalledOnce();
    expect(shutdownLangfuse).toHaveBeenCalledOnce();
    expect(closeRedis).toHaveBeenCalledOnce();
  });
});
