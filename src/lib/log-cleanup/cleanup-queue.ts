import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Job } from "bull";
import Queue from "bull";
import { logger } from "@/lib/logger";
import { getSystemSettings } from "@/repository/system-config";
import { cleanupLogs } from "./service";

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

  // --- START SNI/TLS FIX ---
  const useTls = redisUrl.startsWith("rediss://");
  // Bull 需要一个 RedisOptions 对象
  const redisQueueOptions: Queue.QueueOptions["redis"] = {};

  try {
    // 使用 Node.js 内置的 URL 解析器
    const url = new URL(redisUrl);
    redisQueueOptions.host = url.hostname;
    redisQueueOptions.port = parseInt(url.port || (useTls ? "6379" : "6379"), 10);
    redisQueueOptions.password = url.password;
    redisQueueOptions.username = url.username; // 传递用户名

    if (useTls) {
      logger.info("[CleanupQueue] Using TLS connection (rediss://)");
      redisQueueOptions.tls = {
        host: url.hostname, // 显式 SNI 修复
      };
    }
  } catch (e) {
    logger.error("[CleanupQueue] Failed to parse REDIS_URL, connection will fail:", e);
    // 如果 URL 格式错误，则抛出异常停止启动
    throw new Error("Invalid REDIS_URL format");
  }
  // --- END SNI/TLS FIX ---

  // 创建队列实例
  _cleanupQueue = new Queue("log-cleanup", {
    redis: redisQueueOptions, // 替换：使用我们解析后的对象
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
