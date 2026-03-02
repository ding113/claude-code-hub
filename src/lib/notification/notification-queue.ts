import type { Job } from "bull";
import Queue from "bull";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { logger } from "@/lib/logger";
import {
  applyCacheHitRateAlertCooldownToPayload,
  buildCacheHitRateAlertCooldownKey,
  commitCacheHitRateAlertCooldown,
  generateCacheHitRateAlertPayload,
} from "@/lib/notification/tasks/cache-hit-rate-alert";
import { generateCostAlerts } from "@/lib/notification/tasks/cost-alert";
import { generateDailyLeaderboard } from "@/lib/notification/tasks/daily-leaderboard";
import { resolveSystemTimezone } from "@/lib/utils/timezone.server";
import {
  buildCacheHitRateAlertMessage,
  buildCircuitBreakerMessage,
  buildCostAlertMessage,
  buildDailyLeaderboardMessage,
  type CacheHitRateAlertData,
  type CircuitBreakerAlertData,
  type CostAlertData,
  type DailyLeaderboardData,
  type StructuredMessage,
  sendWebhookMessage,
  type WebhookNotificationType,
} from "@/lib/webhook";
import { isCacheHitRateAlertSettingsWindowMode } from "@/lib/webhook/types";

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
  data?: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData | CacheHitRateAlertData; // 可选：定时任务会在执行时动态生成
}

function toWebhookNotificationType(type: NotificationJobType): WebhookNotificationType {
  switch (type) {
    case "circuit-breaker":
      return "circuit_breaker";
    case "daily-leaderboard":
      return "daily_leaderboard";
    case "cost-alert":
      return "cost_alert";
    case "cache-hit-rate-alert":
      return "cache_hit_rate_alert";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isCacheHitRateAlertSamplePayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const sample = value as Record<string, unknown>;
  return (
    (sample.kind === "eligible" || sample.kind === "overall") &&
    isFiniteNumber(sample.requests) &&
    isFiniteNumber(sample.denominatorTokens) &&
    isFiniteNumber(sample.hitRateTokens)
  );
}

function isCacheHitRateAlertAnomalyPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const anomaly = value as Record<string, unknown>;

  if (!isFiniteNumber(anomaly.providerId)) return false;
  if (typeof anomaly.model !== "string") return false;
  if (!isCacheHitRateAlertSamplePayload(anomaly.current)) return false;

  const baseline = anomaly.baseline;
  if (baseline !== null && baseline !== undefined && !isCacheHitRateAlertSamplePayload(baseline)) {
    return false;
  }

  const baselineSource = anomaly.baselineSource;
  if (
    baselineSource !== null &&
    baselineSource !== undefined &&
    typeof baselineSource !== "string"
  ) {
    return false;
  }

  const dropAbs = anomaly.dropAbs;
  if (dropAbs !== null && dropAbs !== undefined && !isFiniteNumber(dropAbs)) return false;

  const deltaAbs = anomaly.deltaAbs;
  if (deltaAbs !== null && deltaAbs !== undefined && !isFiniteNumber(deltaAbs)) return false;

  const deltaRel = anomaly.deltaRel;
  if (deltaRel !== null && deltaRel !== undefined && !isFiniteNumber(deltaRel)) return false;

  const reasonCodes = anomaly.reasonCodes;
  if (!Array.isArray(reasonCodes) || !reasonCodes.every((code) => typeof code === "string")) {
    return false;
  }

  return true;
}

function isCacheHitRateAlertDataPayload(value: unknown): value is CacheHitRateAlertData {
  if (!isPlainObject(value)) return false;
  const payload = value as Record<string, unknown>;

  if (!isPlainObject(payload.window)) return false;
  const window = payload.window as Record<string, unknown>;
  if (!isCacheHitRateAlertSettingsWindowMode(window.mode)) return false;
  if (typeof window.startTime !== "string") return false;
  if (typeof window.endTime !== "string") return false;
  const windowStartMs = Date.parse(window.startTime);
  if (Number.isNaN(windowStartMs)) return false;
  const windowEndMs = Date.parse(window.endTime);
  if (Number.isNaN(windowEndMs)) return false;
  if (windowEndMs < windowStartMs) return false;
  if (!isFiniteNumber(window.durationMinutes)) return false;

  if (!Array.isArray(payload.anomalies)) return false;
  if (!payload.anomalies.every(isCacheHitRateAlertAnomalyPayload)) return false;

  if (!isPlainObject(payload.settings)) return false;
  const settings = payload.settings as Record<string, unknown>;
  if (!isFiniteNumber(settings.cooldownMinutes)) return false;
  if (!isFiniteNumber(settings.absMin)) return false;
  if (!isFiniteNumber(settings.dropAbs)) return false;
  if (!isFiniteNumber(settings.dropRel)) return false;
  if (!isFiniteNumber(settings.minEligibleRequests)) return false;
  if (!isFiniteNumber(settings.minEligibleTokens)) return false;

  if (!isFiniteNumber(payload.suppressedCount)) return false;

  if (typeof payload.generatedAt !== "string") return false;
  if (Number.isNaN(Date.parse(payload.generatedAt))) return false;

  return true;
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
      // Resolve timezone for formatting
      // Priority: binding's scheduleTimezone > system timezone
      let timezone: string | undefined;
      if (bindingId) {
        const { getBindingById } = await import("@/repository/notification-bindings");
        const binding = await getBindingById(bindingId);
        timezone = binding?.scheduleTimezone ?? undefined;
      }
      if (!timezone) {
        timezone = await resolveSystemTimezone();
      }

      // 特殊：targets 模式下，缓存命中率告警使用 fan-out 作业避免重复计算
      if (type === "cache-hit-rate-alert" && !webhookUrl && !targetId) {
        const { getNotificationSettings } = await import("@/repository/notifications");
        const settings = await getNotificationSettings();

        if (!settings.enabled || !settings.cacheHitRateAlertEnabled) {
          logger.info({
            action: "cache_hit_rate_alert_disabled",
            jobId: job.id,
          });
          return { success: true, skipped: true };
        }

        let payload: CacheHitRateAlertData;

        // 注意：targets 模式的 fan-out 主作业可能会因为 enqueue 失败而触发重试。
        // 因此这里将生成结果写回 job.data，确保重试时使用同一份 payload，避免边界丢失。
        if (data) {
          if (!isCacheHitRateAlertDataPayload(data)) {
            logger.error({
              action: "cache_hit_rate_alert_invalid_payload",
              jobId: job.id,
              reason: "fanout_data_invalid",
            });
            return { success: true, skipped: true };
          }
          payload = data;
        } else {
          const dedupMode = settings.useLegacyMode ? "global" : "none";
          const generated = await generateCacheHitRateAlertPayload({ dedupMode });
          if (!generated) {
            logger.info({
              action: "cache_hit_rate_alert_no_data",
              jobId: job.id,
            });
            return { success: true, skipped: true };
          }

          payload = generated.payload;

          try {
            await job.update({
              ...job.data,
              data: payload,
            });
          } catch (error) {
            logger.error({
              action: "cache_hit_rate_alert_update_failed",
              jobId: job.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (payload.anomalies.length === 0) {
          logger.info({
            action: "cache_hit_rate_alert_no_data",
            jobId: job.id,
          });
          return { success: true, skipped: true };
        }

        if (settings.useLegacyMode) {
          const url = settings.cacheHitRateAlertWebhook?.trim();
          if (!url) {
            logger.info({
              action: "cache_hit_rate_alert_disabled",
              jobId: job.id,
              reason: "legacy_webhook_missing",
            });
            return { success: true, skipped: true };
          }

          const message = buildCacheHitRateAlertMessage(payload, timezone);
          const sendResult = await sendWebhookMessage(url, message, { timezone });

          if (!sendResult.success) {
            throw new Error(sendResult.error || "Failed to send cache hit rate alert");
          }

          const keys = uniqueStrings(
            payload.anomalies.map((a) =>
              buildCacheHitRateAlertCooldownKey({
                providerId: a.providerId,
                model: a.model,
                windowMode: payload.window.mode,
              })
            )
          );

          try {
            await commitCacheHitRateAlertCooldown(keys, payload.settings.cooldownMinutes);
          } catch (error) {
            logger.warn({
              action: "cache_hit_rate_alert_dedup_commit_failed",
              jobId: job.id,
              mode: "legacy",
              keysCount: keys.length,
              cooldownMinutes: payload.settings.cooldownMinutes,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          logger.info({
            action: "cache_hit_rate_alert_sent",
            jobId: job.id,
            mode: "legacy",
            anomalies: payload.anomalies.length,
            suppressedCount: payload.suppressedCount,
          });

          return { success: true };
        }

        const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
        const bindings = await getEnabledBindingsByType("cache_hit_rate_alert");

        if (bindings.length === 0) {
          logger.info({
            action: "cache_hit_rate_alert_skipped",
            jobId: job.id,
            reason: "no_bindings",
          });
          return { success: true, skipped: true };
        }

        const fanoutRunId = String(job.id ?? job.timestamp ?? Date.now());

        for (const binding of bindings) {
          // 使用稳定的 jobId 避免 fan-out 主作业重试时重复 enqueue，造成重复发送
          const childJobId = `cache-hit-rate-alert:${fanoutRunId}:${binding.id}`;

          await queue.add(
            {
              type: "cache-hit-rate-alert",
              targetId: binding.targetId,
              bindingId: binding.id,
              data: payload,
            },
            { jobId: childJobId }
          );
        }

        logger.info({
          action: "cache_hit_rate_alert_fanout_enqueued",
          jobId: job.id,
          mode: "targets",
          targets: bindings.length,
          anomalies: payload.anomalies.length,
          suppressedCount: payload.suppressedCount,
        });

        return { success: true, enqueued: bindings.length };
      }

      // 构建结构化消息
      let message: StructuredMessage;
      let templateData:
        | CircuitBreakerAlertData
        | DailyLeaderboardData
        | CostAlertData
        | CacheHitRateAlertData
        | undefined = data;
      let cooldownCommit: { keys: string[]; cooldownMinutes: number } | undefined;
      switch (type) {
        case "circuit-breaker":
          message = buildCircuitBreakerMessage(data as CircuitBreakerAlertData, timezone);
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
        case "cache-hit-rate-alert": {
          let payload: CacheHitRateAlertData;
          let dedupKeysToSet: string[] | undefined;
          let cooldownMinutes: number | undefined;

          if (data) {
            if (!isCacheHitRateAlertDataPayload(data)) {
              logger.error({
                action: "cache_hit_rate_alert_invalid_payload",
                jobId: job.id,
                targetId,
                bindingId,
              });
              return { success: true, skipped: true };
            }
            payload = data;
          } else {
            // legacy webhook：全局 cooldown 去重；targets：每个 binding 单独去重，避免“一个 target 发送成功后把全局 cooldown 写死”导致其他 target 永久漏发
            // 仅在“生成 payload”路径下使用：当 payload 由 fan-out 预填充时（data 存在），本分支不会执行。
            const generationDedupMode = webhookUrl ? "global" : "none";
            const result = await generateCacheHitRateAlertPayload({
              dedupMode: generationDedupMode,
            });

            if (!result) {
              logger.info({
                action: "cache_hit_rate_alert_no_data",
                jobId: job.id,
              });
              return { success: true, skipped: true };
            }

            payload = result.payload;
            if (generationDedupMode === "global") {
              dedupKeysToSet = result.dedupKeysToSet;
              cooldownMinutes = result.cooldownMinutes;
            }
          }

          if (targetId && bindingId) {
            const applied = await applyCacheHitRateAlertCooldownToPayload({
              payload,
              bindingId,
            });
            payload = applied.payload;
            if (payload.anomalies.length === 0) {
              logger.info({
                action: "cache_hit_rate_alert_all_suppressed",
                jobId: job.id,
                bindingId,
                targetId,
              });
              return { success: true, skipped: true };
            }

            dedupKeysToSet = applied.dedupKeysToSet;
            cooldownMinutes = payload.settings.cooldownMinutes;
          } else {
            dedupKeysToSet ??= uniqueStrings(
              payload.anomalies.map((a) =>
                buildCacheHitRateAlertCooldownKey({
                  providerId: a.providerId,
                  model: a.model,
                  windowMode: payload.window.mode,
                })
              )
            );
            cooldownMinutes ??= payload.settings.cooldownMinutes;
          }

          templateData = payload;
          message = buildCacheHitRateAlertMessage(payload, timezone);
          cooldownCommit = {
            keys: dedupKeysToSet ? uniqueStrings(dedupKeysToSet) : [],
            cooldownMinutes: cooldownMinutes ?? payload.settings.cooldownMinutes,
          };
          break;
        }
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      // 发送通知
      let result;
      if (webhookUrl) {
        result = await sendWebhookMessage(webhookUrl, message, { timezone });
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
          timezone,
        });
      } else {
        throw new Error("Missing notification destination (webhookUrl/targetId)");
      }

      if (!result.success) {
        throw new Error(result.error || "Failed to send notification");
      }

      if (cooldownCommit) {
        try {
          await commitCacheHitRateAlertCooldown(
            cooldownCommit.keys,
            cooldownCommit.cooldownMinutes
          );
        } catch (error) {
          logger.warn({
            action: "cache_hit_rate_alert_dedup_commit_failed",
            jobId: job.id,
            keysCount: cooldownCommit.keys.length,
            cooldownMinutes: cooldownCommit.cooldownMinutes,
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
  data: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData | CacheHitRateAlertData
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
  data: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData | CacheHitRateAlertData
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
        const interval = settings.costAlertCheckInterval ?? 60; // 分钟
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

      if (settings.cacheHitRateAlertEnabled && settings.cacheHitRateAlertWebhook) {
        const intervalMinutesRaw = settings.cacheHitRateAlertCheckInterval ?? 5;
        const intervalMinutes = Math.max(1, Math.trunc(intervalMinutesRaw));
        const clampedIntervalMinutes = Math.min(intervalMinutes, 24 * 60);
        const repeat =
          clampedIntervalMinutes <= 59
            ? { cron: `*/${clampedIntervalMinutes} * * * *` }
            : { every: clampedIntervalMinutes * 60 * 1000 };

        await queue.add(
          {
            type: "cache-hit-rate-alert",
            webhookUrl: settings.cacheHitRateAlertWebhook,
          },
          { repeat, jobId: "cache-hit-rate-alert-scheduled" }
        );

        logger.info({
          action: "cache_hit_rate_alert_scheduled",
          schedule: "cron" in repeat ? repeat.cron : `every:${clampedIntervalMinutes}m`,
          intervalMinutes: clampedIntervalMinutes,
          mode: "legacy",
        });
      }
    } else {
      // 新模式：按绑定调度（支持 cron 覆盖）
      const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
      const systemTimezone = await resolveSystemTimezone();

      if (settings.dailyLeaderboardEnabled) {
        const bindings = await getEnabledBindingsByType("daily_leaderboard");
        const [hour, minute] = (settings.dailyLeaderboardTime ?? "09:00").split(":").map(Number);
        const defaultCron = `${minute} ${hour} * * *`;

        for (const binding of bindings) {
          const cron = binding.scheduleCron ?? defaultCron;
          const tz = binding.scheduleTimezone ?? systemTimezone;

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
          const tz = binding.scheduleTimezone ?? systemTimezone;

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

      if (settings.cacheHitRateAlertEnabled) {
        const bindings = await getEnabledBindingsByType("cache_hit_rate_alert");
        const intervalMinutesRaw = settings.cacheHitRateAlertCheckInterval ?? 5;
        const intervalMinutes = Math.max(1, Math.trunc(intervalMinutesRaw));
        const clampedIntervalMinutes = Math.min(intervalMinutes, 24 * 60);
        const defaultCron = `*/${clampedIntervalMinutes} * * * *`;
        const repeat =
          clampedIntervalMinutes <= 59
            ? { cron: defaultCron, tz: systemTimezone }
            : { every: clampedIntervalMinutes * 60 * 1000 };

        if (bindings.length > 0) {
          // 注意：这里刻意只调度一个共享的 repeat 作业，然后在处理器内 fan-out 到所有 bindings。
          // 这样可以避免对每个 binding 重复计算同一份 payload；代价是 binding 的 scheduleCron/scheduleTimezone 将被忽略。
          // 另外：interval > 59 分钟会使用 repeat.every（固定间隔，不对齐整点，也不支持 tz），这是 Bull cron 分钟字段的限制。
          // 若未来需要支持 per-binding 的 cron/timezone，需要改为“每个 binding 一个 repeat 作业”或引入更细粒度的调度层。
          await queue.add(
            {
              type: "cache-hit-rate-alert",
            },
            {
              repeat,
              jobId: "cache-hit-rate-alert-targets-scheduled",
            }
          );
          logger.info({
            action: "cache_hit_rate_alert_scheduled",
            schedule: "cron" in repeat ? repeat.cron : `every:${clampedIntervalMinutes}m`,
            intervalMinutes: clampedIntervalMinutes,
            targets: bindings.length,
            mode: "targets",
          });
        } else {
          logger.info({
            action: "cache_hit_rate_alert_schedule_skipped",
            schedule:
              clampedIntervalMinutes <= 59 ? defaultCron : `every:${clampedIntervalMinutes}m`,
            intervalMinutes: clampedIntervalMinutes,
            reason: "no_bindings",
            mode: "targets",
          });
        }
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
