import Queue from "bull";
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { logger } from "@/lib/logger";
import { cleanupLogs } from "./service";
import { getSystemSettings } from "@/repository/system-config";

/**
 * 日志清理任务队列
 */
export const cleanupQueue = new Queue("log-cleanup", {
  redis: {
    // 使用 REDIS_URL 环境变量（统一配置）
    ...(process.env.REDIS_URL
      ? { url: process.env.REDIS_URL }
      : { host: "localhost", port: 6379 }),
    // ioredis 快速失败配置
    maxRetriesPerRequest: 3, // 最多重试 3 次
    enableOfflineQueue: false, // 快速失败，不排队
    retryStrategy: (times: number) => {
      if (times > 3) return null; // 停止重试
      return Math.min(times * 200, 1000); // 最多延迟 1 秒
    },
  },
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

/**
 * 处理清理任务
 */
cleanupQueue.process(async (job) => {
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
cleanupQueue.on("failed", (job, err) => {
  logger.error({
    action: "cleanup_job_failed",
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade,
  });
});

/**
 * 添加或更新定时清理任务
 */
export async function scheduleAutoCleanup() {
  try {
    const settings = await getSystemSettings();

    if (!settings.enableAutoCleanup) {
      logger.info({ action: "auto_cleanup_disabled" });

      // 移除所有已存在的定时任务
      const repeatableJobs = await cleanupQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await cleanupQueue.removeRepeatableByKey(job.key);
      }

      return;
    }

    // 移除旧的定时任务
    const repeatableJobs = await cleanupQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await cleanupQueue.removeRepeatableByKey(job.key);
    }

    // 构建清理条件（使用默认值）
    const retentionDays = settings.cleanupRetentionDays ?? 30;
    const beforeDate = new Date();
    beforeDate.setDate(beforeDate.getDate() - retentionDays);

    // 添加新的定时任务
    await cleanupQueue.add(
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

  createBullBoard({
    queues: [new BullAdapter(cleanupQueue)],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}

/**
 * 停止清理队列（优雅关闭）
 */
export async function stopCleanupQueue() {
  await cleanupQueue.close();
  logger.info({ action: "cleanup_queue_closed" });
}
