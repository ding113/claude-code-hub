import { isClientAbortError } from "@/app/v1/_lib/proxy/errors";
import { logger } from "./logger";

/**
 * 异步任务管理器
 *
 * 功能：
 * 1. 统一管理后台异步任务的生命周期
 * 2. 提供任务取消机制（通过 AbortController）
 * 3. 捕获所有异步错误，防止 uncaughtException
 * 4. 自动清理已完成的任务
 *
 * 使用场景：
 * - 流式响应的后台数据处理
 * - 非流式响应的后台统计更新
 * - 任何 fire-and-forget 的异步任务
 */

interface TaskInfo {
  taskId: string;
  promise: Promise<void>;
  abortController: AbortController;
  createdAt: number;
  lastActivityAt: number;
  taskType: string;
  staleTimeoutMs: number;
}

interface RegisterTaskOptions {
  taskType?: string;
  abortController?: AbortController;
  staleTimeoutMs?: number;
}

type AsyncTaskFactory = (signal: AbortSignal) => Promise<void>;

type AsyncTaskLifecycleState = "open" | "draining" | "closed";

const DEFAULT_STALE_TASK_TIMEOUT_MS = 10 * 60 * 1000;

class AsyncTaskManagerClass {
  // tasks 仅指向每个 taskId 的最新 generation；pendingTasks 跟踪所有尚未 settled 的 generation。
  private tasks: Map<string, TaskInfo> = new Map();
  private pendingTasks: Set<TaskInfo> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private lifecycleState: AsyncTaskLifecycleState = "open";
  // Lazily initialize Node-only hooks on first use to avoid side effects at import time.
  private initialized = false;

  private initializeIfNeeded(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // Skip initialization in Edge/CI environments to avoid Node-only APIs and side effects.
    if (
      process.env.NEXT_RUNTIME === "edge" ||
      process.env.CI === "true" ||
      process.env.NEXT_PHASE === "phase-production-build"
    ) {
      logger.debug("[AsyncTaskManager] Skipping initialization in edge/CI environment", {
        nextRuntime: process.env.NEXT_RUNTIME,
        ci: process.env.CI,
      });
      return;
    }

    // SIGTERM/SIGINT 的取消时机由 src/lib/lifecycle/shutdown.ts 编排：
    // 不在 drain 阶段取消任务（否则 server.close() 的 drain 完全失去意义——
    // SSE/流式响应正期望被允许自然结束）。编排器进入 cleanup 阶段后才会调用
    // shutdownAllAsyncTasks()。这里只保留 beforeExit 兜底，覆盖事件循环自然
    // 耗尽路径（例如脚本类调用方未触发 SIGTERM）。
    process.once("beforeExit", () => {
      logger.info("[AsyncTaskManager] beforeExit reached, cancelling remaining tasks", {
        activeTaskCount: this.pendingTasks.size,
      });
      this.cleanupAll();
    });

    // 每分钟检查并清理空闲超时任务，防止挂死后台任务长期强引用上下文。
    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedTasks();
    }, 60000);
  }

  /**
   * 注册一个异步任务
   *
   * @param taskId 任务唯一标识
   * @param factory 通过 admission 后才启动的异步任务 factory
   * @param taskType 任务类型（用于日志）
   * @returns AbortController（可用于取消任务）
   */
  register(
    taskId: string,
    factory: AsyncTaskFactory,
    taskTypeOrOptions: string | RegisterTaskOptions = "unknown"
  ): AbortController {
    const options =
      typeof taskTypeOrOptions === "string" ? { taskType: taskTypeOrOptions } : taskTypeOrOptions;
    const taskType = options.taskType ?? "unknown";
    const abortController = options.abortController ?? new AbortController();

    if (
      this.lifecycleState === "closed" ||
      (this.lifecycleState === "draining" && this.pendingTasks.size === 0)
    ) {
      abortController.abort();
      return abortController;
    }

    this.initializeIfNeeded();

    const previousLatest = this.tasks.get(taskId);

    const staleTimeoutMs =
      options.staleTimeoutMs === undefined || options.staleTimeoutMs <= 0
        ? DEFAULT_STALE_TASK_TIMEOUT_MS
        : options.staleTimeoutMs;
    const now = Date.now();

    let resolveTask!: () => void;
    let rejectTask!: (reason?: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    const taskInfo: TaskInfo = {
      taskId,
      promise,
      abortController,
      createdAt: now,
      lastActivityAt: now,
      taskType,
      staleTimeoutMs,
    };

    this.tasks.set(taskId, taskInfo);
    this.pendingTasks.add(taskInfo);

    if (previousLatest) {
      logger.warn("[AsyncTaskManager] Task already exists, cancelling old task", {
        taskId,
        taskType,
      });
      if (!previousLatest.abortController.signal.aborted) {
        previousLatest.abortController.abort();
      }
      logger.info("[AsyncTaskManager] Task cancelled", {
        taskId,
        taskType: previousLatest.taskType,
        age: Date.now() - previousLatest.createdAt,
      });
    }

    // 任务完成后自动清理
    promise
      .then(() => {
        logger.debug("[AsyncTaskManager] Task completed successfully", {
          taskId,
          taskType,
          duration: Date.now() - taskInfo.createdAt,
        });
      })
      .catch((error) => {
        // 如果是取消操作，使用 info 级别
        if (isClientAbortError(error)) {
          logger.info("[AsyncTaskManager] Task cancelled", {
            taskId,
            taskType,
            reason: error.message,
          });
        } else {
          // 其他错误使用 error 级别
          logger.error("[AsyncTaskManager] Task failed with error", {
            taskId,
            taskType,
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
          });
        }
      })
      .finally(() => {
        this.cleanup(taskId, taskInfo);
      });

    logger.debug("[AsyncTaskManager] Task registered", {
      taskId,
      taskType,
      activeTasks: this.pendingTasks.size,
    });

    if (abortController.signal.aborted) {
      resolveTask();
    } else {
      try {
        Promise.resolve(factory(abortController.signal)).then(resolveTask, rejectTask);
      } catch (error) {
        rejectTask(error);
      }
    }

    return abortController;
  }

  /**
   * 标记任务仍在推进。流式任务每次读到 chunk 都应 touch，避免长时间活跃流被
   * wall-clock stale cleanup 误判为挂死任务。
   */
  touch(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) {
      return false;
    }

    taskInfo.lastActivityAt = Date.now();
    return true;
  }

  /**
   * 取消一个任务
   *
   * @param taskId 任务唯一标识
   */
  cancel(taskId: string): void {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) {
      logger.debug("[AsyncTaskManager] Task not found for cancellation", { taskId });
      return;
    }

    if (!taskInfo.abortController.signal.aborted) {
      taskInfo.abortController.abort();
    }

    logger.info("[AsyncTaskManager] Task cancelled", {
      taskId,
      taskType: taskInfo.taskType,
      age: Date.now() - taskInfo.createdAt,
    });
  }

  /**
   * 清理单个任务。必须带上注册时的任务实例，避免旧任务 finally 误删同 taskId 的新任务。
   *
   * @param taskId 任务唯一标识
   */
  private cleanup(taskId: string, expectedTask: TaskInfo): boolean {
    if (!this.pendingTasks.delete(expectedTask)) {
      return false;
    }

    if (this.tasks.get(taskId) === expectedTask) {
      this.tasks.delete(taskId);
    }

    logger.debug("[AsyncTaskManager] Task cleaned up", {
      taskId,
      remainingTasks: this.pendingTasks.size,
    });
    return true;
  }

  /**
   * 检查并清理超时任务
   *
   * 遍历所有活跃任务，对于空闲时间超过任务级 staleTimeoutMs 的任务：
   * 1. 记录警告日志
   * 2. 触发 AbortController 取消任务
   * 3. 保持 pending 跟踪，直到真实 Promise settled
   *
   * 注意：这是清理"空闲超时"的任务。活跃流应在收到上游 chunk 时
   * 调用 touch() 更新 lastActivityAt，避免被误判为挂死任务。
   */
  private cleanupCompletedTasks(): void {
    const now = Date.now();

    for (const taskInfo of this.pendingTasks) {
      const { taskId } = taskInfo;
      const age = now - taskInfo.createdAt;
      const idleAge = now - taskInfo.lastActivityAt;

      const staleTimeoutMs = taskInfo.staleTimeoutMs || DEFAULT_STALE_TASK_TIMEOUT_MS;

      // stale cleanup 只负责发出一次取消；settlement 才拥有移除 pending 跟踪的权限。
      if (idleAge > staleTimeoutMs && !taskInfo.abortController.signal.aborted) {
        logger.warn("[AsyncTaskManager] Task timeout, cancelling", {
          taskId,
          taskType: taskInfo.taskType,
          age,
          idleAge,
          staleTimeoutMs,
        });
        taskInfo.abortController.abort();
      }
    }
  }

  /**
   * 清理所有任务（进程退出时调用）
   */
  cleanupAll(): void {
    this.lifecycleState = "closed";
    logger.info("[AsyncTaskManager] Cleaning up all tasks", {
      count: this.pendingTasks.size,
    });

    for (const taskInfo of Array.from(this.pendingTasks)) {
      if (!taskInfo.abortController.signal.aborted) {
        taskInfo.abortController.abort();
      }
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 取消并等待 shutdown 时仍在飞的全部任务 settled。
   *
   * task 的 finally 可能在等待期间注册尾部任务，因此循环到 pending 集合为空；并发 shutdown
   * 调用共享同一个 Promise，避免重复取消或提前返回。
   */
  shutdownAll(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    let resolveShutdown!: () => void;
    let rejectShutdown!: (reason?: unknown) => void;
    const shutdownPromise = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve;
      rejectShutdown = reject;
    });
    this.shutdownPromise = shutdownPromise;
    this.lifecycleState = "draining";

    // 先发布共享 Promise，再同步开始 abort；这样既保留既有同步取消语义，
    // 同步 abort listener 重入时也会复用同一次 shutdown。
    void (async () => {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      while (true) {
        if (this.pendingTasks.size === 0) {
          this.lifecycleState = "closed";
          return;
        }

        const activeTasks = Array.from(this.pendingTasks);
        logger.info("[AsyncTaskManager] Cancelling and joining active tasks", {
          count: activeTasks.length,
        });

        for (const taskInfo of activeTasks) {
          if (!taskInfo.abortController.signal.aborted) {
            taskInfo.abortController.abort();
          }
        }

        await Promise.allSettled(activeTasks.map((taskInfo) => taskInfo.promise));

        for (const taskInfo of activeTasks) {
          this.cleanup(taskInfo.taskId, taskInfo);
        }
      }
    })().then(resolveShutdown, (error) => {
      this.lifecycleState = "closed";
      rejectShutdown(error);
    });

    return shutdownPromise;
  }

  /**
   * 获取当前活跃任务数
   */
  getActiveTaskCount(): number {
    return this.pendingTasks.size;
  }

  /**
   * 获取所有活跃任务的信息
   */
  getActiveTasks(): Array<{ taskId: string; taskType: string; age: number }> {
    const now = Date.now();
    return Array.from(this.pendingTasks).map((taskInfo) => ({
      taskId: taskInfo.taskId,
      taskType: taskInfo.taskType,
      age: now - taskInfo.createdAt,
    }));
  }
}

// 导出单例（使用 globalThis 缓存避免热重载时重复实例化）
const g = globalThis as unknown as { __ASYNC_TASK_MANAGER__?: AsyncTaskManagerClass };
export const AsyncTaskManager =
  g.__ASYNC_TASK_MANAGER__ ?? (g.__ASYNC_TASK_MANAGER__ = new AsyncTaskManagerClass());

// 供 shutdown 编排器调用：在 cleanup 阶段（server.close 完成后）才取消残留任务，
// 避免 drain 期间打断流式响应。
export function shutdownAllAsyncTasks(): Promise<void> {
  return AsyncTaskManager.shutdownAll();
}
