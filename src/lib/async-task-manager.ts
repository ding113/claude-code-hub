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
  taskType: string;
}

class AsyncTaskManagerClass {
  private tasks: Map<string, TaskInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Skip initialization during CI/build phase to avoid unnecessary logs and side effects
    if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
      logger.debug("[AsyncTaskManager] Skipping initialization in CI/build environment");
      return;
    }

    // 定义统一的清理处理器
    const exitHandler = (signal: string) => {
      logger.info(`[AsyncTaskManager] Received ${signal}, cleaning up all tasks`, {
        activeTaskCount: this.tasks.size,
      });
      this.cleanupAll();
    };

    // 监听所有退出信号（确保 Docker 环境下优雅关闭）
    // 使用 once 而非 on，避免重复注册（特别是热重载场景）
    process.once("SIGTERM", () => exitHandler("SIGTERM")); // Docker stop
    process.once("SIGINT", () => exitHandler("SIGINT")); // Ctrl+C
    process.once("beforeExit", () => exitHandler("beforeExit")); // 正常退出

    // 每分钟检查并清理超时任务（>10 分钟未完成，防止内存泄漏）
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
  register(taskId: string, promise: Promise<void>, taskType = "unknown"): AbortController {
    // 如果任务已存在，先取消旧任务
    if (this.tasks.has(taskId)) {
      logger.warn("[AsyncTaskManager] Task already exists, cancelling old task", {
        taskId,
        taskType,
      });
      this.cancel(taskId);
    }

    const abortController = new AbortController();

    const taskInfo: TaskInfo = {
      promise,
      abortController,
      createdAt: Date.now(),
      taskType,
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
        this.cleanup(taskId);
      });

    logger.debug("[AsyncTaskManager] Task registered", {
      taskId,
      taskType,
      activeTasks: this.tasks.size,
    });

    return abortController;
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

    taskInfo.abortController.abort();

    logger.info("[AsyncTaskManager] Task cancelled", {
      taskId,
      taskType: taskInfo.taskType,
      age: Date.now() - taskInfo.createdAt,
    });
  }

  /**
   * 清理单个任务
   *
   * @param taskId 任务唯一标识
   */
  cleanup(taskId: string): void {
    const deleted = this.tasks.delete(taskId);
    if (deleted) {
      logger.debug("[AsyncTaskManager] Task cleaned up", {
        taskId,
        remainingTasks: this.tasks.size,
      });
    }
  }

  /**
   * 检查并清理超时任务
   *
   * 遍历所有活跃任务，对于超过 10 分钟还未完成的任务：
   * 1. 记录警告日志
   * 2. 触发 AbortController 取消任务
   * 3. 从任务 Map 中移除
   *
   * ⚠️ 注意：这不是清理"已完成"的任务，而是清理"超时未完成"的任务
   */
  private cleanupCompletedTasks(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 分钟

    for (const [taskId, taskInfo] of this.tasks.entries()) {
      const age = now - taskInfo.createdAt;

      // 如果任务超过 10 分钟还没完成，记录警告并取消
      if (age > staleThreshold) {
        logger.warn("[AsyncTaskManager] Task timeout, cancelling", {
          taskId,
          taskType: taskInfo.taskType,
          age,
        });
        this.cancel(taskId);
      }
    }
  }

  /**
   * 清理所有任务（进程退出时调用）
   */
  private cleanupAll(): void {
    logger.info("[AsyncTaskManager] Cleaning up all tasks", {
      count: this.tasks.size,
    });

    for (const taskId of this.tasks.keys()) {
      this.cancel(taskId);
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
