import type { Job } from "bull";
import Queue from "bull";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { logger } from "@/lib/logger";
import {
  buildCircuitBreakerMessage,
  buildCostAlertMessage,
  buildDailyLeaderboardMessage,
  type CircuitBreakerAlertData,
  type CostAlertData,
  type DailyLeaderboardData,
  type StructuredMessage,
  sendWebhookMessage,
  type WebhookNotificationType,
} from "@/lib/webhook";
import { generateCostAlerts } from "./tasks/cost-alert";
import { generateDailyLeaderboard } from "./tasks/daily-leaderboard";

/**
 * 通知任务数据
 */
export interface NotificationJobData {
  type: NotificationJobType;
  // legacy 模式使用（单 URL）
  webhookUrl?: string;
  // 新模式使用（多目标）
  targetId?: number;
  bindingId?: number;
  data?: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData; // 可选：定时任务会在执行时动态生成
}

function toWebhookNotificationType(type: NotificationJobType): WebhookNotificationType {
  switch (type) {
    case "circuit-breaker":
      return "circuit_breaker";
    case "daily-leaderboard":
      return "daily_leaderboard";
    case "cost-alert":
      return "cost_alert";
  }
}

/**
 * 队列实例（延迟初始化，避免 Turbopack 编译时加载）
 */
let _notificationQueue: Queue.Queue<NotificationJobData> | null = null;

/**
 * 获取或创建通知队列实例（延迟初始化）
 * 修复：避免在模块加载时实例化，确保环境变量正确读取
 */
function getNotificationQueue(): Queue.Queue<NotificationJobData> {
  if (_notificationQueue) {
    return _notificationQueue;
  }

  // 检查 Redis 配置
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error({
      action: "notification_queue_init_error",
      error: "REDIS_URL environment variable is not set",
    });
    throw new Error("REDIS_URL environment variable is required for notification queue");
  }

  logger.info({
    action: "notification_queue_initializing",
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
      const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false";
      logger.info("[NotificationQueue] Using TLS connection (rediss://)", { rejectUnauthorized });
      redisQueueOptions.tls = {
        host: url.hostname,
        servername: url.hostname, // SNI support for cloud Redis providers
        rejectUnauthorized,
      };
    }
  } catch (e) {
    logger.error("[NotificationQueue] Failed to parse REDIS_URL, connection will fail:", e);
    // 如果 URL 格式错误，则抛出异常停止启动
    throw new Error("Invalid REDIS_URL format");
  }
  // --- END SNI/TLS FIX ---

  // 创建队列实例
  _notificationQueue = new Queue<NotificationJobData>("notifications", {
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
  setupQueueProcessor(_notificationQueue);

  logger.info({ action: "notification_queue_initialized" });

  return _notificationQueue;
}

/**
 * 设置队列处理器和事件监听（抽取为独立函数）
 */
function setupQueueProcessor(queue: Queue.Queue<NotificationJobData>): void {
  /**
   * 处理通知任务
   */
  queue.process(async (job: Job<NotificationJobData>) => {
    const { type, webhookUrl, targetId, bindingId, data } = job.data;

    logger.info({
      action: "notification_job_start",
      jobId: job.id,
      type,
    });

    try {
      // 构建结构化消息
      let message: StructuredMessage;
      let templateData: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData | undefined =
        data;
      switch (type) {
        case "circuit-breaker":
          message = buildCircuitBreakerMessage(data as CircuitBreakerAlertData);
          break;
        case "daily-leaderboard": {
          // 动态生成排行榜数据
          const { getNotificationSettings } = await import("@/repository/notifications");
          const settings = await getNotificationSettings();
          const leaderboardData = await generateDailyLeaderboard(
            settings.dailyLeaderboardTopN || 5
          );

          if (!leaderboardData) {
            logger.info({
              action: "daily_leaderboard_no_data",
              jobId: job.id,
            });
            return { success: true, skipped: true };
          }

          templateData = leaderboardData;
          message = buildDailyLeaderboardMessage(leaderboardData);
          break;
        }
        case "cost-alert": {
          // 动态生成成本预警数据
          const { getNotificationSettings } = await import("@/repository/notifications");
          const settings = await getNotificationSettings();
          const alerts = await generateCostAlerts(
            parseFloat(settings.costAlertThreshold || "0.80")
          );

          if (alerts.length === 0) {
            logger.info({
              action: "cost_alert_no_data",
              jobId: job.id,
            });
            return { success: true, skipped: true };
          }

          // 发送第一个告警（后续可扩展为批量发送）
          templateData = alerts[0];
          message = buildCostAlertMessage(alerts[0]);
          break;
        }
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      // 发送通知
      let result;
      if (webhookUrl) {
        result = await sendWebhookMessage(webhookUrl, message);
      } else if (targetId) {
        const { getWebhookTargetById } = await import("@/repository/webhook-targets");
        const target = await getWebhookTargetById(targetId);

        if (!target || !target.isEnabled) {
          logger.warn({
            action: "notification_target_missing_or_disabled",
            jobId: job.id,
            type,
            targetId,
          });
          return { success: true, skipped: true };
        }

        const notificationType = toWebhookNotificationType(type);

        let templateOverride: Record<string, unknown> | null = null;
        if (bindingId) {
          const { getBindingById } = await import("@/repository/notification-bindings");
          const binding = await getBindingById(bindingId);
          templateOverride = binding?.templateOverride ?? null;
        }

        result = await sendWebhookMessage(target, message, {
          notificationType,
          data: templateData,
          templateOverride,
        });
      } else {
        throw new Error("Missing notification destination (webhookUrl/targetId)");
      }

      if (!result.success) {
        throw new Error(result.error || "Failed to send notification");
      }

      logger.info({
        action: "notification_job_complete",
        jobId: job.id,
        type,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({
        action: "notification_job_error",
        jobId: job.id,
        type,
        error: errorMessage,
      });

      throw error; // 重新抛出错误以触发重试
    }
  });

  /**
   * 错误处理
   */
  queue.on("failed", (job: Job<NotificationJobData>, err: Error) => {
    logger.error({
      action: "notification_job_failed",
      jobId: job.id,
      type: job.data.type,
      error: err.message,
      attempts: job.attemptsMade,
    });
  });
}

/**
 * 添加通知任务
 */
export async function addNotificationJob(
  type: NotificationJobType,
  webhookUrl: string,
  data: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData
): Promise<void> {
  try {
    const queue = getNotificationQueue();
    await queue.add({
      type,
      webhookUrl,
      data,
    });

    logger.info({
      action: "notification_job_added",
      type,
    });
  } catch (error) {
    logger.error({
      action: "notification_job_add_error",
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 新模式：为指定目标添加通知任务
 */
export async function addNotificationJobForTarget(
  type: NotificationJobType,
  targetId: number,
  bindingId: number | null,
  data: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData
): Promise<void> {
  try {
    const queue = getNotificationQueue();
    await queue.add({
      type,
      targetId,
      ...(bindingId ? { bindingId } : {}),
      data,
    });

    logger.info({
      action: "notification_job_added",
      type,
      targetId,
    });
  } catch (error) {
    logger.error({
      action: "notification_job_add_error",
      type,
      targetId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 调度定时通知任务
 */
export async function scheduleNotifications() {
  try {
    // 动态导入以避免循环依赖
    const { getNotificationSettings } = await import("@/repository/notifications");
    const settings = await getNotificationSettings();

    const queue = getNotificationQueue();

    if (!settings.enabled) {
      logger.info({ action: "notifications_disabled" });

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

    if (settings.useLegacyMode) {
      // legacy 模式：单 URL
      if (
        settings.dailyLeaderboardEnabled &&
        settings.dailyLeaderboardWebhook &&
        settings.dailyLeaderboardTime
      ) {
        const [hour, minute] = settings.dailyLeaderboardTime.split(":").map(Number);
        const cron = `${minute} ${hour} * * *`; // 每天指定时间

        await queue.add(
          {
            type: "daily-leaderboard",
            webhookUrl: settings.dailyLeaderboardWebhook,
            // data 字段省略，任务执行时动态生成
          },
          {
            repeat: { cron },
            jobId: "daily-leaderboard-scheduled",
          }
        );

        logger.info({
          action: "daily_leaderboard_scheduled",
          schedule: cron,
          mode: "legacy",
        });
      }

      if (settings.costAlertEnabled && settings.costAlertWebhook) {
        const interval = settings.costAlertCheckInterval; // 分钟
        const cron = `*/${interval} * * * *`; // 每 N 分钟

        await queue.add(
          {
            type: "cost-alert",
            webhookUrl: settings.costAlertWebhook,
            // data 字段省略，任务执行时动态生成
          },
          {
            repeat: { cron },
            jobId: "cost-alert-scheduled",
          }
        );

        logger.info({
          action: "cost_alert_scheduled",
          schedule: cron,
          intervalMinutes: interval,
          mode: "legacy",
        });
      }
    } else {
      // 新模式：按绑定调度（支持 cron 覆盖）
      const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");

      if (settings.dailyLeaderboardEnabled) {
        const bindings = await getEnabledBindingsByType("daily_leaderboard");
        const [hour, minute] = (settings.dailyLeaderboardTime ?? "09:00").split(":").map(Number);
        const defaultCron = `${minute} ${hour} * * *`;

        for (const binding of bindings) {
          const cron = binding.scheduleCron ?? defaultCron;
          const tz = binding.scheduleTimezone ?? "Asia/Shanghai";

          await queue.add(
            {
              type: "daily-leaderboard",
              targetId: binding.targetId,
              bindingId: binding.id,
            },
            {
              repeat: { cron, tz },
              jobId: `daily-leaderboard:${binding.id}`,
            }
          );
        }

        logger.info({
          action: "daily_leaderboard_scheduled",
          schedule: defaultCron,
          targets: bindings.length,
          mode: "targets",
        });
      }

      if (settings.costAlertEnabled) {
        const bindings = await getEnabledBindingsByType("cost_alert");
        const interval = settings.costAlertCheckInterval ?? 60;
        const defaultCron = `*/${interval} * * * *`;

        for (const binding of bindings) {
          const cron = binding.scheduleCron ?? defaultCron;
          const tz = binding.scheduleTimezone ?? "Asia/Shanghai";

          await queue.add(
            {
              type: "cost-alert",
              targetId: binding.targetId,
              bindingId: binding.id,
            },
            {
              repeat: { cron, tz },
              jobId: `cost-alert:${binding.id}`,
            }
          );
        }

        logger.info({
          action: "cost_alert_scheduled",
          schedule: defaultCron,
          intervalMinutes: interval,
          targets: bindings.length,
          mode: "targets",
        });
      }
    }

    logger.info({ action: "notifications_scheduled" });
  } catch (error) {
    logger.error({
      action: "schedule_notifications_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail Open: 调度失败不影响应用启动
  }
}

/**
 * 停止通知队列(优雅关闭)
 */
export async function stopNotificationQueue() {
  if (_notificationQueue) {
    await _notificationQueue.close();
    logger.info({ action: "notification_queue_closed" });
  }
}
