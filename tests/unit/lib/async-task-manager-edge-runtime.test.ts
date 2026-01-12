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
    AsyncTaskManager.register("t1", Promise.resolve());

    expect(processOnceSpy).not.toHaveBeenCalled();
  });

  it("registers exit hooks when NEXT_RUNTIME is nodejs", async () => {
    vi.useFakeTimers();

    const processOnceSpy = vi.spyOn(process, "once");
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    AsyncTaskManager.register("t1", Promise.resolve());

    expect(processOnceSpy).toHaveBeenCalledTimes(3);
    expect(processOnceSpy).toHaveBeenNthCalledWith(1, "SIGTERM", expect.any(Function));
    expect(processOnceSpy).toHaveBeenNthCalledWith(2, "SIGINT", expect.any(Function));
    expect(processOnceSpy).toHaveBeenNthCalledWith(3, "beforeExit", expect.any(Function));
  });

  it("handles exit signal callback by running cleanupAll", async () => {
    vi.useFakeTimers();

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const processOnceSpy = vi.spyOn(process, "once");
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = AsyncTaskManager.register("t1", taskPromise);

    const sigtermHandler = processOnceSpy.mock.calls.find((c) => c[0] === "SIGTERM")?.[1];
    const sigintHandler = processOnceSpy.mock.calls.find((c) => c[0] === "SIGINT")?.[1];
    const beforeExitHandler = processOnceSpy.mock.calls.find((c) => c[0] === "beforeExit")?.[1];
    expect(sigtermHandler).toBeTypeOf("function");
    expect(sigintHandler).toBeTypeOf("function");
    expect(beforeExitHandler).toBeTypeOf("function");

    sigtermHandler?.();
    sigintHandler?.();
    beforeExitHandler?.();

    expect(controller.signal.aborted).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();

    resolveTask!();
    await taskPromise;
  });

  it("runs cleanupCompletedTasks on interval tick", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    const cleanupSpy = vi.spyOn(
      AsyncTaskManager as unknown as { cleanupCompletedTasks: () => void },
      "cleanupCompletedTasks"
    );

    AsyncTaskManager.register("t1", new Promise<void>(() => {}));
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

    const controller = AsyncTaskManager.register("t1", taskPromise);
    expect(controller.signal.aborted).toBe(false);
    expect(AsyncTaskManager.getActiveTaskCount()).toBe(1);

    resolveTask!();
    await taskPromise;
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(AsyncTaskManager.getActiveTaskCount()).toBe(0);
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

    AsyncTaskManager.register("t1", taskPromise, "custom_type");

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

    const firstController = AsyncTaskManager.register("t1", firstPromise);
    expect(firstController.signal.aborted).toBe(false);

    let resolveSecond: () => void;
    const secondPromise = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    AsyncTaskManager.register("t1", secondPromise);

    expect(firstController.signal.aborted).toBe(true);

    resolveFirst!();
    resolveSecond!();
    await Promise.all([firstPromise, secondPromise]);
  });

  it("logs task cancelled when isClientAbortError returns true", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { isClientAbortError } = await import("@/app/v1/_lib/proxy/errors");
    vi.mocked(isClientAbortError).mockReturnValue(true);

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    const taskPromise = Promise.reject(new Error("aborted"));
    AsyncTaskManager.register("t1", taskPromise);

    await taskPromise.catch(() => {});

    expect(vi.mocked(logger.info)).toHaveBeenCalled();
  });

  it("logs task failed when isClientAbortError returns false", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { isClientAbortError } = await import("@/app/v1/_lib/proxy/errors");
    vi.mocked(isClientAbortError).mockReturnValue(false);

    const { logger } = await import("@/lib/logger");
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    const taskPromise = Promise.reject(new Error("boom"));
    AsyncTaskManager.register("t1", taskPromise);

    await taskPromise.catch(() => {});

    expect(vi.mocked(logger.error)).toHaveBeenCalled();
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

    const controller = AsyncTaskManager.register("stale-task", taskPromise, "custom_type");

    const managerAny = AsyncTaskManager as unknown as {
      tasks: Map<string, { createdAt: number }>;
      cleanupCompletedTasks: () => void;
    };
    const info = managerAny.tasks.get("stale-task");
    expect(info).toBeDefined();
    info!.createdAt = Date.now() - 11 * 60 * 1000;

    let resolveFresh: () => void;
    const freshPromise = new Promise<void>((resolve) => {
      resolveFresh = resolve;
    });
    const freshController = AsyncTaskManager.register("fresh-task", freshPromise, "custom_type");

    managerAny.cleanupCompletedTasks();

    expect(controller.signal.aborted).toBe(true);
    expect(freshController.signal.aborted).toBe(false);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();

    resolveTask!();
    resolveFresh!();
    await Promise.all([taskPromise, freshPromise]);
  });

  it("cleanupAll cancels tasks and clears interval", async () => {
    process.env.CI = "true";
    process.env.NEXT_RUNTIME = "nodejs";

    const { AsyncTaskManager } = await import("@/lib/async-task-manager");

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    const controller = AsyncTaskManager.register("t1", taskPromise);

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const intervalId = setInterval(() => {}, 1_000);
    const managerAny = AsyncTaskManager as unknown as {
      cleanupInterval: ReturnType<typeof setInterval> | null;
      cleanupAll: () => void;
    };
    managerAny.cleanupInterval = intervalId;

    managerAny.cleanupAll();

    expect(controller.signal.aborted).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
    expect(managerAny.cleanupInterval).toBeNull();

    resolveTask!();
    await taskPromise;
    clearInterval(intervalId);
  });
});
