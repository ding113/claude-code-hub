import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  isClientAbortError: vi.fn(() => false),
}));

describe.sequential("AsyncTaskManager edge runtime", () => {
  const prevRuntime = process.env.NEXT_RUNTIME;
  const prevCi = process.env.CI;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useRealTimers();

    delete (globalThis as unknown as { __ASYNC_TASK_MANAGER__?: unknown }).__ASYNC_TASK_MANAGER__;

    delete process.env.CI;
  });

  afterEach(() => {
    process.env.NEXT_RUNTIME = prevRuntime;
    if (prevCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = prevCi;
    }

    delete (globalThis as unknown as { __ASYNC_TASK_MANAGER__?: unknown }).__ASYNC_TASK_MANAGER__;

    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not call process.once when NEXT_RUNTIME is edge", async () => {
    const processOnceSpy = vi.spyOn(process, "once");
    process.env.NEXT_RUNTIME = "edge";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    AsyncTaskManager.register("t1", async () => {});

    expect(processOnceSpy).not.toHaveBeenCalled();
  });

  it("registers only beforeExit when NEXT_RUNTIME is nodejs (SIGTERM/SIGINT are owned by server.js orchestrator)", async () => {
    vi.useFakeTimers();

    const processOnceSpy = vi.spyOn(process, "once");
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    AsyncTaskManager.register("t1", async () => {});

    const signals = processOnceSpy.mock.calls.map((c) => c[0]);
    expect(signals).toContain("beforeExit");
    expect(signals).not.toContain("SIGTERM");
    expect(signals).not.toContain("SIGINT");
  });

  it("beforeExit callback runs cleanupAll", async () => {
    vi.useFakeTimers();

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const processOnceSpy = vi.spyOn(process, "once");
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = AsyncTaskManager.register("t1", () => taskPromise);

    const beforeExitHandler = processOnceSpy.mock.calls.find((c) => c[0] === "beforeExit")?.[1];
    expect(beforeExitHandler).toBeTypeOf("function");

    beforeExitHandler?.();

    expect(controller.signal.aborted).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();

    resolveTask!();
    await taskPromise;
  });

  it("shutdownAllAsyncTasks cancels all in-flight tasks", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = AsyncTaskManager.register("t1", () => taskPromise);
    expect(controller.signal.aborted).toBe(false);

    shutdownAllAsyncTasks();

    expect(controller.signal.aborted).toBe(true);

    resolveTask!();
    await taskPromise;
  });

  it("does not start tasks registered after shutdown observes an empty task snapshot", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    const shutdownPromise = shutdownAllAsyncTasks();
    let taskStarted = false;
    const lateController = AsyncTaskManager.register("late-task", async () => {
      taskStarted = true;
      await new Promise<void>(() => {});
    });
    const lateRegistrationState = {
      aborted: lateController.signal.aborted,
      active: AsyncTaskManager.getActiveTaskCount(),
      taskStarted,
    };
    const repeatedShutdownPromise = shutdownAllAsyncTasks();

    expect({
      samePromise: repeatedShutdownPromise === shutdownPromise,
      ...lateRegistrationState,
    }).toEqual({
      samePromise: true,
      aborted: true,
      active: 0,
      taskStarted: false,
    });
  });

  it("joins a tail task registered synchronously by an abort listener", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");
    const firstController = new AbortController();
    let resolveFirst!: () => void;
    const firstTask = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let tailStarted = false;
    let tailAborted = false;

    firstController.signal.addEventListener(
      "abort",
      () => {
        AsyncTaskManager.register("tail-task", async (signal) => {
          tailStarted = true;
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                tailAborted = true;
                resolve();
              },
              { once: true }
            );
          });
        });
        resolveFirst();
      },
      { once: true }
    );

    AsyncTaskManager.register("first-task", () => firstTask, {
      abortController: firstController,
    });

    await shutdownAllAsyncTasks();

    expect(tailStarted).toBe(true);
    expect(tailAborted).toBe(true);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("publishes task admission before a factory synchronously reenters shutdown", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");
    let resolveTask!: () => void;
    let reentrantShutdown: Promise<void> | undefined;

    const controller = AsyncTaskManager.register("reentrant-task", async () => {
      reentrantShutdown = shutdownAllAsyncTasks();
      await new Promise<void>((resolve) => {
        resolveTask = resolve;
      });
    });
    const repeatedShutdown = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    repeatedShutdown.then(() => {
      shutdownSettled = true;
    });

    expect(reentrantShutdown).toBe(repeatedShutdown);
    expect(controller.signal.aborted).toBe(true);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(shutdownSettled).toBe(false);

    resolveTask();
    await repeatedShutdown;

    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("runs cleanupCompletedTasks on interval tick", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    const cleanupSpy = vi.spyOn(
      AsyncTaskManager as unknown as { cleanupCompletedTasks: () => void },
      "cleanupCompletedTasks"
    );

    AsyncTaskManager.register("t1", async () => new Promise<void>(() => {}));
    vi.advanceTimersByTime(60_000);

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("registers and auto-cleans task after resolve", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const controller = AsyncTaskManager.register("t1", () => taskPromise);
    expect(controller.signal.aborted).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);

    resolveTask!();
    await taskPromise;
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
    });
  });

  it("does nothing when cancelling unknown taskId", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    AsyncTaskManager.cancel("missing");

    expect(vi.mocked(logger.debug)).toHaveBeenCalled();
  });

  it("getActiveTasks returns task metadata", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    AsyncTaskManager.register("t1", () => taskPromise, "custom_type");

    const tasks = AsyncTaskManager.getActiveTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ taskId: "t1", taskType: "custom_type" });
    expect(typeof tasks[0]?.age).toBe("number");

    resolveTask!();
    await taskPromise;
  });

  it("cancels old task when registering same taskId again", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const firstController = AsyncTaskManager.register("t1", () => firstPromise);
    expect(firstController.signal.aborted).toBe(false);

    let resolveSecond: () => void;
    const secondPromise = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    AsyncTaskManager.register("t1", () => secondPromise);

    expect(firstController.signal.aborted).toBe(true);

    resolveFirst!();
    resolveSecond!();
    await Promise.all([firstPromise, secondPromise]);
  });

  it("does not start B when aborting same-ID A synchronously registers C", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveA!: () => void;
    let resolveC!: () => void;
    let cStartCount = 0;
    const aController = AsyncTaskManager.register(
      "t1",
      async (signal) => {
        signal.addEventListener(
          "abort",
          () => {
            AsyncTaskManager.register(
              "t1",
              async () => {
                cStartCount += 1;
                await new Promise<void>((resolve) => {
                  resolveC = resolve;
                });
              },
              "generation-c"
            );
          },
          { once: true }
        );

        await new Promise<void>((resolve) => {
          resolveA = resolve;
        });
      },
      "generation-a"
    );

    let bStartCount = 0;
    const bController = AsyncTaskManager.register(
      "t1",
      async () => {
        bStartCount += 1;
      },
      "generation-b"
    );

    expect({
      bAborted: bController.signal.aborted,
      bStartCount,
      cStartCount,
    }).toEqual({
      bAborted: true,
      bStartCount: 0,
      cStartCount: 1,
    });

    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTasks().map(({ taskType }) => taskType)).toEqual([
        "generation-a",
        "generation-c",
      ]);
    });

    const shutdownPromise = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    shutdownPromise.then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(aController.signal.aborted).toBe(true);
    expect(shutdownSettled).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(2);

    resolveA();
    resolveC();
    await shutdownPromise;

    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("keeps an aborted duplicate task generation joinable until its factory settles", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveFirst!: () => void;
    let firstAborted = false;
    let firstFinalized = false;
    const firstController = AsyncTaskManager.register("t1", async (signal) => {
      signal.addEventListener("abort", () => {
        firstAborted = true;
      });

      try {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      } finally {
        firstFinalized = true;
      }
    });

    let resolveSecond!: () => void;
    let secondAborted = false;
    AsyncTaskManager.register("t1", async (signal) => {
      signal.addEventListener("abort", () => {
        secondAborted = true;
      });

      await new Promise<void>((resolve) => {
        resolveSecond = resolve;
      });
    });

    expect(firstController.signal.aborted).toBe(true);
    expect(firstAborted).toBe(true);
    expect(firstFinalized).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(2);

    const shutdownPromise = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    shutdownPromise.then(() => {
      shutdownSettled = true;
    });

    expect(secondAborted).toBe(true);
    resolveSecond();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdownSettled).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);

    resolveFirst();
    await shutdownPromise;

    expect(firstFinalized).toBe(true);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("retains the prior generation when a duplicate factory throws synchronously", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveFirst!: () => void;
    const firstController = AsyncTaskManager.register("t1", async () => {
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });

    AsyncTaskManager.register("t1", () => {
      throw new Error("replacement failed before returning a promise");
    });

    expect(firstController.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);
    });

    const shutdownPromise = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    shutdownPromise.then(() => {
      shutdownSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdownSettled).toBe(false);

    resolveFirst();
    await shutdownPromise;

    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("joins a same-id generation registered by an abort listener during shutdown", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveFirst!: () => void;
    let resolveTail!: () => void;
    let firstFinalized = false;
    let tailStarted = false;
    let tailAborted = false;

    AsyncTaskManager.register("t1", async (signal) => {
      signal.addEventListener(
        "abort",
        () => {
          AsyncTaskManager.register("t1", async (tailSignal) => {
            tailStarted = true;
            tailSignal.addEventListener("abort", () => {
              tailAborted = true;
            });
            await new Promise<void>((resolve) => {
              resolveTail = resolve;
            });
          });
          resolveFirst();
        },
        { once: true }
      );

      try {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      } finally {
        firstFinalized = true;
      }
    });

    const shutdownPromise = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    shutdownPromise.then(() => {
      shutdownSettled = true;
    });

    expect(tailStarted).toBe(true);
    await vi.waitFor(() => {
      expect(tailAborted).toBe(true);
      expect(firstFinalized).toBe(true);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdownSettled).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);

    resolveTail();
    await shutdownPromise;

    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("does not let an old task finalizer remove a newer task with the same taskId", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    AsyncTaskManager.register("t1", () => firstPromise);

    let resolveSecond: () => void;
    const secondPromise = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    AsyncTaskManager.register("t1", () => secondPromise);

    resolveFirst!();
    await firstPromise;
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);
    });

    resolveSecond!();
    await secondPromise;
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
    });
  });

  it("logs task cancelled when isClientAbortError returns true", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { isClientAbortError } = await import("@/app/v1/_lib/proxy/errors");
    vi.mocked(isClientAbortError).mockReturnValue(true);

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    const taskPromise = Promise.reject(new Error("aborted"));
    AsyncTaskManager.register("t1", () => taskPromise);

    await taskPromise.catch(() => {});

    await vi.waitFor(() => {
      expect(vi.mocked(logger.info)).toHaveBeenCalled();
    });
  });

  it("logs task failed when isClientAbortError returns false", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { isClientAbortError } = await import("@/app/v1/_lib/proxy/errors");
    vi.mocked(isClientAbortError).mockReturnValue(false);

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    const taskPromise = Promise.reject(new Error("boom"));
    AsyncTaskManager.register("t1", () => taskPromise);

    await taskPromise.catch(() => {});

    await vi.waitFor(() => {
      expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });
  });

  it("keeps a stale task tracked until its promise settles during shutdown", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager, shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");

    let resolveTask!: () => void;
    let taskSettled = false;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    }).finally(() => {
      taskSettled = true;
    });
    const controller = AsyncTaskManager.register("stale-task", () => taskPromise, {
      staleTimeoutMs: 1,
    });

    vi.advanceTimersByTime(60_000);

    const shutdownPromise = shutdownAllAsyncTasks();
    let shutdownSettled = false;
    shutdownPromise.then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    const stateBeforeSettlement = {
      aborted: controller.signal.aborted,
      active: AsyncTaskManager.getActiveTaskCount(),
      shutdownSettled,
      taskSettled,
    };

    resolveTask();
    await taskPromise;
    await shutdownPromise;

    expect(stateBeforeSettlement).toEqual({
      aborted: true,
      active: 1,
      shutdownSettled: false,
      taskSettled: false,
    });
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
  });

  it("cleanupCompletedTasks cancels stale tasks", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const controller = AsyncTaskManager.register("stale-task", () => taskPromise, "custom_type");

    const managerAny = AsyncTaskManager as unknown as {
      tasks: Map<string, { createdAt: number; lastActivityAt: number }>;
      cleanupCompletedTasks: () => void;
    };
    const info = managerAny.tasks.get("stale-task");
    expect(info).toBeDefined();
    const oldTimestamp = Date.now() - 11 * 60 * 1000;
    info!.createdAt = oldTimestamp;
    info!.lastActivityAt = oldTimestamp;

    let resolveFresh: () => void;
    const freshPromise = new Promise<void>((resolve) => {
      resolveFresh = resolve;
    });
    const freshController = AsyncTaskManager.register(
      "fresh-task",
      () => freshPromise,
      "custom_type"
    );

    managerAny.cleanupCompletedTasks();

    expect(controller.signal.aborted).toBe(true);
    expect(freshController.signal.aborted).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(2);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();

    resolveTask!();
    resolveFresh!();
    await Promise.all([taskPromise, freshPromise]);
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
    });
  });

  it("does not cancel a long-running task that was recently touched", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const controller = AsyncTaskManager.register(
      "active-stream",
      () => taskPromise,
      "stream-processing"
    );

    const managerAny = AsyncTaskManager as unknown as {
      tasks: Map<string, { createdAt: number; lastActivityAt: number }>;
      cleanupCompletedTasks: () => void;
    };
    const info = managerAny.tasks.get("active-stream");
    expect(info).toBeDefined();
    const oldTimestamp = Date.now() - 11 * 60 * 1000;
    info!.createdAt = oldTimestamp;
    info!.lastActivityAt = oldTimestamp;

    expect(AsyncTaskManager.touch("active-stream")).toBe(true);
    managerAny.cleanupCompletedTasks();

    expect(controller.signal.aborted).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);
    expect(AsyncTaskManager.touch("missing-task")).toBe(false);

    resolveTask!();
    await taskPromise;
  });

  it("cleanupCompletedTasks retains a stale task until its provided promise settles", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = new AbortController();

    const returnedController = AsyncTaskManager.register("stale-task", () => taskPromise, {
      taskType: "stream-processing",
      abortController: controller,
    });
    expect(returnedController).toBe(controller);

    const managerAny = AsyncTaskManager as unknown as {
      tasks: Map<string, { createdAt: number; lastActivityAt: number }>;
      cleanupCompletedTasks: () => void;
    };
    const info = managerAny.tasks.get("stale-task");
    expect(info).toBeDefined();
    const oldTimestamp = Date.now() - 11 * 60 * 1000;
    info!.createdAt = oldTimestamp;
    info!.lastActivityAt = oldTimestamp;

    managerAny.cleanupCompletedTasks();

    expect(controller.signal.aborted).toBe(true);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);

    resolveTask!();
    await taskPromise;
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
    });
  });

  it("cleanupAll cancels tasks and clears interval", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = AsyncTaskManager.register("t1", () => taskPromise);

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const intervalId = setInterval(() => {}, 1_000);
    const managerAny = AsyncTaskManager as unknown as {
      cleanupInterval: ReturnType<typeof setInterval> | null;
      cleanupAll: () => void;
    };
    managerAny.cleanupInterval = intervalId;

    managerAny.cleanupAll();

    expect(controller.signal.aborted).toBe(true);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
    expect(managerAny.cleanupInterval).toBeNull();

    resolveTask!();
    await taskPromise;
    await vi.waitFor(() => {
      expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
    });
    clearInterval(intervalId);
  });
});
