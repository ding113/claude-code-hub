import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe.sequential("数据库连接池 shutdown", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it("message writer flush 完成后关闭所有数据库 pool", async () => {
    const lifecycle: string[] = [];
    const closeDbPools = vi.fn(async () => {
      lifecycle.push("db");
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
      stopMessageRequestWriteBuffer: async () => {
        lifecycle.push("writer");
      },
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    await runApplicationCleanup("SIGTERM", { totalTimeoutMs: 5_000, perStepTimeoutMs: 500 });

    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(["writer", "db"]);
  });

  it("writer 前整体 deadline 已到也不能提前完成 cleanup", async () => {
    vi.useFakeTimers();
    let resolveTasks!: () => void;
    const tasksSettled = new Promise<void>((resolve) => {
      resolveTasks = resolve;
    });
    const stopMessageRequestWriteBuffer = vi.fn(async () => {});
    const closeDbPools = vi.fn(async () => {});

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
    vi.doMock("@/lib/async-task-manager", () => ({
      shutdownAllAsyncTasks: () => tasksSettled,
    }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer,
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    let cleanupSettled = false;
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 100,
      perStepTimeoutMs: 1_000,
    });
    void cleanup.then(
      () => {
        cleanupSettled = true;
      },
      () => {
        cleanupSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(cleanupSettled).toBe(false);
    expect(stopMessageRequestWriteBuffer).not.toHaveBeenCalled();

    resolveTasks();
    await vi.advanceTimersByTimeAsync(0);
    await cleanup;

    expect(stopMessageRequestWriteBuffer).toHaveBeenCalledTimes(1);
    expect(closeDbPools).toHaveBeenCalledTimes(1);
  });

  it("message writer 超过单步 timeout 时继续等待，settled 后才关闭数据库 pool", async () => {
    vi.useFakeTimers();
    const lifecycle: string[] = [];
    let resolveWriter!: () => void;
    const writerStopped = new Promise<void>((resolve) => {
      resolveWriter = () => {
        lifecycle.push("writer");
        resolve();
      };
    });
    const closeDbPools = vi.fn(async () => {
      lifecycle.push("db");
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
      stopMessageRequestWriteBuffer: () => writerStopped,
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    let cleanupSettled = false;
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 1_000,
      perStepTimeoutMs: 100,
    });
    void cleanup.then(
      () => {
        cleanupSettled = true;
      },
      () => {
        cleanupSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(cleanupSettled).toBe(false);
    expect(closeDbPools).not.toHaveBeenCalled();

    resolveWriter();
    await vi.advanceTimersByTimeAsync(0);
    await cleanup;

    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(["writer", "db"]);
  });

  it("message writer 到整体 deadline 仍未 settled 时 cleanup 保持 pending，settled 后才关闭 pool", async () => {
    vi.useFakeTimers();
    const lifecycle: string[] = [];
    let resolveWriter!: () => void;
    const writerStopped = new Promise<void>((resolve) => {
      resolveWriter = () => {
        lifecycle.push("writer");
        resolve();
      };
    });
    const closeDbPools = vi.fn(async () => {
      lifecycle.push("db");
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
      stopMessageRequestWriteBuffer: () => writerStopped,
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 500,
      perStepTimeoutMs: 100,
    });
    let cleanupSettled = false;
    void cleanup.then(
      () => {
        cleanupSettled = true;
      },
      () => {
        cleanupSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(cleanupSettled).toBe(false);
    expect(closeDbPools).not.toHaveBeenCalled();

    resolveWriter();
    await vi.advanceTimersByTimeAsync(0);
    await cleanup;

    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(["writer", "db"]);
  });

  it("数据库 pool close 超过单步 timeout 时不得 detach", async () => {
    vi.useFakeTimers();
    let resolveClose!: () => void;
    const poolClosed = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const closeDbPools = vi.fn(() => poolClosed);
    const shutdownLangfuse = vi.fn(async () => {});

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
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: async () => {} }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: async () => {},
    }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools }));

    const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");
    let cleanupSettled = false;
    const cleanup = runApplicationCleanup("SIGTERM", {
      totalTimeoutMs: 500,
      perStepTimeoutMs: 100,
    });
    void cleanup.then(
      () => {
        cleanupSettled = true;
      },
      () => {
        cleanupSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(cleanupSettled).toBe(false);
    expect(shutdownLangfuse).not.toHaveBeenCalled();

    resolveClose();
    await vi.advanceTimersByTimeAsync(0);
    await cleanup;

    expect(shutdownLangfuse).toHaveBeenCalledTimes(1);
  });
});
