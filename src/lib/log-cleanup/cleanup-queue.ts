import Queue from "bull";
import type { Job } from "bull";
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { logger } from "@/lib/logger";
import { cleanupLogs } from "./service";
import { getSystemSettings } from "@/repository/system-config";

/**
 * 队列实例（延迟初始化，避免模块加载时连接 Redis）
 */
let _cleanupQueue: Queue.Queue | null = null;

/**
 * 获取或创建清理队列实例（延迟初始化）
 * 修复：避免在模块加载时实例化，防止 unhandledRejection
 */
function getCleanupQueue(): Queue.Queue {
  if (_cleanupQueue) {
    return _cleanupQueue;
  }

  // 检查 Redis 配置
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error({
      action: "cleanup_queue_init_error",
      error: "REDIS_URL environment variable is not set",
    });
    throw new Error("REDIS_URL environment variable is required for cleanup queue");
  }

  logger.info({
    action: "cleanup_queue_initializing",
    redisUrl: redisUrl.replace(/:[^:]*@/, ":***@"), // 隐藏密码
  });

  // 创建队列实例
  _cleanupQueue = new Queue("log-cleanup", {
    redis: redisUrl, // 直接使用 URL 字符串
    defaultJobOptions: {
      attempts: 3, // 失败重试 3 次
      backoff: {
        type: "exponential",
        delay: 60000, // 首次重试延迟 1 分钟
      },
      removeOnComplete: 100, // 保留最近 100 个完成任务
      removeOnFail: 50, // 保留最近 50 个失败任务
    },
  });

  // 注册任务处理器
  setupQueueProcessor(_cleanupQueue);

  logger.info({ action: "cleanup_queue_initialized" });

  return _cleanupQueue;
}

/**
 * 设置队列处理器和事件监听（抽取为独立函数）
 */
function setupQueueProcessor(queue: Queue.Queue): void {
  /**
   * 处理清理任务
   */
  queue.process(async (job: Job) => {
    logger.info({
      action: "cleanup_job_start",
      jobId: job.id,
      conditions: job.data.conditions,
    });

    const result = await cleanupLogs(
      job.data.conditions,
      { batchSize: job.data.batchSize },
      { type: "scheduled" }
    );

    if (result.error) {
      throw new Error(result.error);
    }

    logger.info({
      action: "cleanup_job_complete",
      jobId: job.id,
      totalDeleted: result.totalDeleted,
      durationMs: result.durationMs,
    });

    return result;
  });

  /**
   * 错误处理
   */
  queue.on("failed", (job: Job, err: Error) => {
    logger.error({
      action: "cleanup_job_failed",
      jobId: job.id,
      error: err.message,
      attempts: job.attemptsMade,
    });
  });
}

/**
 * 添加或更新定时清理任务
 */
export async function scheduleAutoCleanup() {
  try {
    const settings = await getSystemSettings();
    const queue = getCleanupQueue();

    if (!settings.enableAutoCleanup) {
      logger.info({ action: "auto_cleanup_disabled" });

      // 移除所有已存在的定时任务
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await queue.removeRepeatableByKey(job.key);
      }

      return;
    }

    // 移除旧的定时任务
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await queue.removeRepeatableByKey(job.key);
    }

    // 构建清理条件（使用默认值）
    const retentionDays = settings.cleanupRetentionDays ?? 30;
    const beforeDate = new Date();
    beforeDate.setDate(beforeDate.getDate() - retentionDays);

    // 添加新的定时任务
    await queue.add(
      "auto-cleanup",
      {
        conditions: { beforeDate },
        batchSize: settings.cleanupBatchSize ?? 10000,
      },
      {
        repeat: {
          cron: settings.cleanupSchedule ?? "0 2 * * *", // 默认每天凌晨 2 点
        },
      }
    );

    logger.info({
      action: "auto_cleanup_scheduled",
      schedule: settings.cleanupSchedule ?? "0 2 * * *",
      retentionDays,
      batchSize: settings.cleanupBatchSize ?? 10000,
    });
  } catch (error) {
    logger.error({
      action: "schedule_auto_cleanup_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail Open: 调度失败不影响应用启动
  }
}

/**
 * Bull Board 监控面板
 */
export function createCleanupMonitor() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  const queue = getCleanupQueue();
  createBullBoard({
    queues: [new BullAdapter(queue)],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}

/**
 * 停止清理队列（优雅关闭）
 */
export async function stopCleanupQueue() {
  if (_cleanupQueue) {
    await _cleanupQueue.close();
    logger.info({ action: "cleanup_queue_closed" });
  }
}
