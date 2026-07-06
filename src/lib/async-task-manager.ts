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

const DEFAULT_STALE_TASK_TIMEOUT_MS = 10 * 60 * 1000;

class AsyncTaskManagerClass {
  private tasks: Map<string, TaskInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
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
        activeTaskCount: this.tasks.size,
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
   * @param promise 异步任务 Promise
   * @param taskType 任务类型（用于日志）
   * @returns AbortController（可用于取消任务）
   */
  register(
    taskId: string,
    promise: Promise<void>,
    taskTypeOrOptions: string | RegisterTaskOptions = "unknown"
  ): AbortController {
    this.initializeIfNeeded();

    const options =
      typeof taskTypeOrOptions === "string" ? { taskType: taskTypeOrOptions } : taskTypeOrOptions;
    const taskType = options.taskType ?? "unknown";

    // 如果任务已存在，先取消旧任务
    const oldTaskInfo = this.tasks.get(taskId);
    if (oldTaskInfo) {
      logger.warn("[AsyncTaskManager] Task already exists, cancelling old task", {
        taskId,
        taskType,
      });
      this.cancel(taskId);
      this.cleanup(taskId, oldTaskInfo);
    }

    const abortController = options.abortController ?? new AbortController();
    const staleTimeoutMs =
      options.staleTimeoutMs === undefined || options.staleTimeoutMs <= 0
        ? DEFAULT_STALE_TASK_TIMEOUT_MS
        : options.staleTimeoutMs;
    const now = Date.now();

    const taskInfo: TaskInfo = {
      promise,
      abortController,
      createdAt: now,
      lastActivityAt: now,
      taskType,
      staleTimeoutMs,
    };

    this.tasks.set(taskId, taskInfo);

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
      activeTasks: this.tasks.size,
    });

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
    if (this.tasks.get(taskId) !== expectedTask) {
      return false;
    }

    const deleted = this.tasks.delete(taskId);
    if (deleted) {
      logger.debug("[AsyncTaskManager] Task cleaned up", {
        taskId,
        remainingTasks: this.tasks.size,
      });
    }
    return deleted;
  }

  /**
   * 检查并清理超时任务
   *
   * 遍历所有活跃任务，对于空闲时间超过任务级 staleTimeoutMs 的任务：
   * 1. 记录警告日志
   * 2. 触发 AbortController 取消任务
   * 3. 从任务 Map 中移除
   *
   * 注意：这是清理"空闲超时"的任务。活跃流应在收到上游 chunk 时
   * 调用 touch() 更新 lastActivityAt，避免被误判为挂死任务。
   */
  private cleanupCompletedTasks(): void {
    const now = Date.now();

    for (const [taskId, taskInfo] of this.tasks.entries()) {
      const age = now - taskInfo.createdAt;
      const idleAge = now - taskInfo.lastActivityAt;

      const staleTimeoutMs = taskInfo.staleTimeoutMs || DEFAULT_STALE_TASK_TIMEOUT_MS;

      // 如果任务超过阈值没有任何进展，记录警告、取消并从 Map 断开强引用。
      if (idleAge > staleTimeoutMs) {
        logger.warn("[AsyncTaskManager] Task timeout, cancelling and detaching", {
          taskId,
          taskType: taskInfo.taskType,
          age,
          idleAge,
          staleTimeoutMs,
        });
        this.cancel(taskId);
        this.cleanup(taskId, taskInfo);
      }
    }
  }

  /**
   * 清理所有任务（进程退出时调用）
   */
  cleanupAll(): void {
    logger.info("[AsyncTaskManager] Cleaning up all tasks", {
      count: this.tasks.size,
    });

    for (const [taskId, taskInfo] of Array.from(this.tasks.entries())) {
      this.cancel(taskId);
      this.cleanup(taskId, taskInfo);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 获取当前活跃任务数
   */
  getActiveTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * 获取所有活跃任务的信息
   */
  getActiveTasks(): Array<{ taskId: string; taskType: string; age: number }> {
    const now = Date.now();
    return Array.from(this.tasks.entries()).map(([taskId, taskInfo]) => ({
      taskId,
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
export function shutdownAllAsyncTasks(): void {
  AsyncTaskManager.cleanupAll();
}
