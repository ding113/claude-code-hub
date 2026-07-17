import { logger } from "@/lib/logger";

// 单进程级 shutdown 状态：readiness 探针读取它在收到 SIGTERM 后立刻返回 503，
// 让 Service/Ingress 提前摘流，避免新连接打到正在 drain 的 pod 上。
let shuttingDown = false;

export function markShuttingDown(): void {
  if (!shuttingDown) {
    shuttingDown = true;
    logger.info("[Shutdown] marked as shutting down");
  }
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

// 仅供测试重置内部状态，正常代码路径不使用。
export function __resetShutdownStateForTests(): void {
  shuttingDown = false;
}

// 单步 timeout：超时 / 失败都不能让整个关闭流程被阻塞，因此 catch + 计时器双保险。
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`[Shutdown] ${label} timed out`, { ms });
      resolve();
    }, ms);
  });
  try {
    await Promise.race([
      p.then(
        () => undefined,
        (error) => {
          logger.warn(`[Shutdown] ${label} failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function awaitWithWarning<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const timer = setTimeout(() => {
    logger.warn(`[Shutdown] ${label} still pending`, { ms });
  }, ms);
  try {
    return await p;
  } finally {
    clearTimeout(timer);
  }
}

async function awaitQuiescenceBestEffort(
  promise: Promise<unknown>,
  warningMs: number,
  label: string
): Promise<void> {
  try {
    await awaitWithWarning(promise, warningMs, label);
  } catch (error) {
    logger.warn(`[Shutdown] ${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const DEFAULT_STEP_TIMEOUT_MS = 3000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10000;

export interface RunCleanupOptions {
  // Cleanup 的慢操作告警阈值；最终强制退出由 server.js hard watchdog 负责。
  totalTimeoutMs?: number;
  perStepTimeoutMs?: number;
}

// 串行执行资源回收。非关键步骤超时后继续；async task、writer 与 DB pool 是不可 detach 的
// critical barrier，超时只告警，失败则向 server.js 传播并触发非零退出。
export async function runApplicationCleanup(
  signal: string,
  opts: RunCleanupOptions = {}
): Promise<void> {
  const stepMs = opts.perStepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const totalMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;

  const startedAt = Date.now();
  logger.info("[Shutdown] application cleanup starting", { signal, totalMs, stepMs });
  let writerQuiescencePending = false;
  const deferredErrors: Error[] = [];

  const work = (async () => {
    // 1. 停止本地周期任务（不需要做 IO，几乎是同步）
    await awaitQuiescenceBestEffort(
      (async () => {
        const { stopCacheCleanup } = await import("@/lib/cache/session-cache");
        stopCacheCleanup();
      })(),
      stepMs,
      "stopCacheCleanup"
    );

    // 2. 端点探测调度器
    await awaitQuiescenceBestEffort(
      (async () => {
        const { stopEndpointProbeScheduler } = await import(
          "@/lib/provider-endpoints/probe-scheduler"
        );
        await stopEndpointProbeScheduler();
      })(),
      stepMs,
      "stopEndpointProbeScheduler"
    );

    // 3. 公共状态重建调度器
    await awaitQuiescenceBestEffort(
      (async () => {
        const { stopPublicStatusRebuildScheduler } = await import("@/lib/public-status/scheduler");
        await stopPublicStatusRebuildScheduler();
      })(),
      stepMs,
      "stopPublicStatusRebuildScheduler"
    );

    // 4. 端点探测日志清理
    await awaitQuiescenceBestEffort(
      (async () => {
        const { stopEndpointProbeLogCleanup } = await import(
          "@/lib/provider-endpoints/probe-log-cleanup"
        );
        await stopEndpointProbeLogCleanup();
      })(),
      stepMs,
      "stopEndpointProbeLogCleanup"
    );

    // 5. Bull queues own Redis connections and may still ACK jobs or emit DB work.
    //    Join them before closing either backing resource.
    try {
      await awaitWithWarning(
        (async () => {
          const stopQueues = (
            globalThis as typeof globalThis & {
              __CCH_STOP_BACKGROUND_QUEUES__?: () => Promise<void>;
            }
          ).__CCH_STOP_BACKGROUND_QUEUES__;
          if (stopQueues) await stopQueues();
        })(),
        stepMs,
        "stopBackgroundQueues"
      );
    } catch (error) {
      const queueError = error instanceof Error ? error : new Error(String(error));
      deferredErrors.push(queueError);
      logger.error("[Shutdown] background queues failed to stop; continuing critical cleanup", {
        error: queueError.message,
      });
    }

    // 6. 取消仍在飞的后台异步任务。
    //    必须排在 message-buffer flush 之前——任务被 abort 时仍会写出尾部日志/用量记录，
    //    flush 才能把这些尾部更新真正落库。
    const asyncTasksWarningTimer = setTimeout(() => {
      logger.warn("[Shutdown] shutdownAllAsyncTasks still pending", { ms: stepMs });
    }, stepMs);
    try {
      const { shutdownAllAsyncTasks } = await import("@/lib/async-task-manager");
      await shutdownAllAsyncTasks();
    } catch (error) {
      logger.error("[Shutdown] async tasks failed to settle", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(asyncTasksWarningTimer);
    }

    // 7. 刷写 message_request 异步写缓冲。这里不能用可脱离的单步 timeout：
    //    closeDbPools 必须等 writer 真正 settled，否则会关闭仍在执行终态 SQL 的连接。
    writerQuiescencePending = true;
    const writerWarningTimer = setTimeout(() => {
      logger.warn("[Shutdown] stopMessageRequestWriteBuffer still pending", { ms: stepMs });
    }, stepMs);
    try {
      const { stopMessageRequestWriteBuffer } = await import("@/repository/message-write-buffer");
      await stopMessageRequestWriteBuffer();
    } catch (error) {
      logger.error("[Shutdown] message writer failed to quiesce; database pools remain open", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(writerWarningTimer);
      writerQuiescencePending = false;
    }

    // 8. writer flush 完成后再关闭数据库 pool。pool close 也是 critical barrier，
    //    单步 deadline 只能告警，不能让底层 client.end() 脱离 shutdown 生命周期。
    const dbWarningTimer = setTimeout(() => {
      logger.warn("[Shutdown] closeDbPools still pending", { ms: stepMs });
    }, stepMs);
    try {
      const { closeDbPools } = await import("@/drizzle/db");
      await closeDbPools();
    } catch (error) {
      logger.error("[Shutdown] database pools failed to close", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(dbWarningTimer);
    }

    // 9. Langfuse 自带超时（LANGFUSE_SHUTDOWN_TIMEOUT_MS），这里再加一层兜底
    await withTimeout(
      (async () => {
        const { shutdownLangfuse } = await import("@/lib/langfuse");
        await shutdownLangfuse();
      })(),
      stepMs,
      "shutdownLangfuse"
    );

    // 10. Redis 连接最后关：上面的步骤可能仍在写日志/缓存
    await withTimeout(
      (async () => {
        const { closeRedis } = await import("@/lib/redis");
        await closeRedis();
      })(),
      stepMs,
      "closeRedis"
    );

    // 11. API Key Vacuum Filter 订阅清理 —— 同步函数，不需要 timeout
    try {
      const g = globalThis as unknown as {
        __CCH_API_KEY_VF_SYNC_CLEANUP__?: (() => void) | null;
      };
      g.__CCH_API_KEY_VF_SYNC_CLEANUP__?.();
    } catch (error) {
      logger.warn("[Shutdown] api-key vacuum filter cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 12. 云价格定时同步
    try {
      const g = globalThis as unknown as {
        __CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__?: ReturnType<typeof setInterval>;
      };
      if (g.__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__) {
        clearInterval(g.__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__);
        g.__CCH_CLOUD_PRICE_SYNC_INTERVAL_ID__ = undefined;
      }
    } catch (error) {
      logger.warn("[Shutdown] cloud price sync scheduler cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (deferredErrors.length > 0) {
      throw new AggregateError(deferredErrors, "Application cleanup completed with errors");
    }
  })();

  const totalWarningTimer = setTimeout(() => {
    logger.warn(
      "[Shutdown] application cleanup total timeout reached; continuing critical cleanup",
      { totalMs }
    );
    if (writerQuiescencePending) {
      logger.error(
        "[Shutdown] cleanup deadline reached with message writer still active; continuing to wait",
        { totalMs }
      );
    }
  }, totalMs);

  try {
    await work;
  } finally {
    clearTimeout(totalWarningTimer);
  }

  logger.info("[Shutdown] application cleanup complete", {
    signal,
    elapsedMs: Date.now() - startedAt,
  });
}

interface LifecycleGlobals {
  markShuttingDown: () => void;
  isShuttingDown: () => boolean;
  runApplicationCleanup: (signal: string, opts?: RunCleanupOptions) => Promise<void>;
}

// 让 server.js（CommonJS 入口，无法直接 import TS 模块）通过 globalThis 调用关闭逻辑。
// 与本仓库其他桥接惯例一致：参见 src/app/v1/_lib/responses-ws/upstream-adapter.ts:332。
export function bindLifecycleGlobals(): void {
  const g = globalThis as unknown as { __CCH_LIFECYCLE__?: LifecycleGlobals };
  if (g.__CCH_LIFECYCLE__) return;
  g.__CCH_LIFECYCLE__ = {
    markShuttingDown,
    isShuttingDown,
    runApplicationCleanup,
  };
}
