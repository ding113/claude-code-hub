import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import type { CircuitBreakerAlertData } from "@/lib/webhook";
import { generateCostAlerts } from "./tasks/cost-alert";
import { generateDailyLeaderboard } from "./tasks/daily-leaderboard";

/**
 * 发送熔断器告警通知
 * 防止重复推送：使用 Redis 缓存 5 分钟内不重复发送同一供应商的告警
 */
export async function sendCircuitBreakerAlert(data: CircuitBreakerAlertData): Promise<void> {
  try {
    // 检查是否开启熔断器告警
    const { getNotificationSettings } = await import("@/repository/notifications");
    const settings = await getNotificationSettings();

    if (!settings.enabled || !settings.circuitBreakerEnabled) {
      logger.info({
        action: "circuit_breaker_alert_disabled",
        providerId: data.providerId,
      });
      return;
    }

    // 防止 5 分钟内重复告警
    const redisClient = getRedisClient();
    if (redisClient) {
      const cacheKey = `circuit-breaker-alert:${data.providerId}`;
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        logger.info({
          action: "circuit_breaker_alert_suppressed",
          providerId: data.providerId,
          reason: "duplicate_within_5min",
        });
        return;
      }

      // 动态导入通知队列（避免 Turbopack 编译 Bull）
      const { addNotificationJob, addNotificationJobForTarget } = await import(
        "./notification-queue"
      );

      if (settings.useLegacyMode) {
        if (!settings.circuitBreakerWebhook) {
          logger.info({
            action: "circuit_breaker_alert_disabled",
            providerId: data.providerId,
            reason: "legacy_webhook_missing",
          });
          return;
        }

        await addNotificationJob("circuit-breaker", settings.circuitBreakerWebhook, data);
      } else {
        const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
        const bindings = await getEnabledBindingsByType("circuit_breaker");

        if (bindings.length === 0) {
          logger.info({
            action: "circuit_breaker_alert_skipped",
            providerId: data.providerId,
            reason: "no_bindings",
          });
          return;
        }

        for (const binding of bindings) {
          await addNotificationJobForTarget("circuit-breaker", binding.targetId, binding.id, data);
        }
      }

      // 设置缓存，5 分钟过期
      await redisClient.set(cacheKey, "1", "EX", 300);
    } else {
      // Redis 不可用，直接发送告警
      const { addNotificationJob, addNotificationJobForTarget } = await import(
        "./notification-queue"
      );

      if (settings.useLegacyMode) {
        if (!settings.circuitBreakerWebhook) {
          logger.info({
            action: "circuit_breaker_alert_disabled",
            providerId: data.providerId,
            reason: "legacy_webhook_missing",
          });
          return;
        }

        await addNotificationJob("circuit-breaker", settings.circuitBreakerWebhook, data);
      } else {
        const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
        const bindings = await getEnabledBindingsByType("circuit_breaker");

        if (bindings.length === 0) {
          logger.info({
            action: "circuit_breaker_alert_skipped",
            providerId: data.providerId,
            reason: "no_bindings",
          });
          return;
        }

        for (const binding of bindings) {
          await addNotificationJobForTarget("circuit-breaker", binding.targetId, binding.id, data);
        }
      }
    }

    logger.info({
      action: "circuit_breaker_alert_sent",
      providerId: data.providerId,
    });
  } catch (error) {
    logger.error({
      action: "send_circuit_breaker_alert_error",
      providerId: data.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 发送每日排行榜通知（定时任务调用）
 */
export async function sendDailyLeaderboard(): Promise<void> {
  try {
    const { getNotificationSettings } = await import("@/repository/notifications");
    const settings = await getNotificationSettings();

    if (!settings.enabled || !settings.dailyLeaderboardEnabled) {
      logger.info({ action: "daily_leaderboard_disabled" });
      return;
    }

    // 生成排行榜数据
    const data = await generateDailyLeaderboard(settings.dailyLeaderboardTopN || 5);

    if (!data) {
      logger.info({ action: "daily_leaderboard_no_data" });
      return;
    }

    // 动态导入通知队列
    const { addNotificationJob, addNotificationJobForTarget } = await import(
      "./notification-queue"
    );

    if (settings.useLegacyMode) {
      if (!settings.dailyLeaderboardWebhook) {
        logger.info({ action: "daily_leaderboard_disabled", reason: "legacy_webhook_missing" });
        return;
      }
      await addNotificationJob("daily-leaderboard", settings.dailyLeaderboardWebhook, data);
    } else {
      const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
      const bindings = await getEnabledBindingsByType("daily_leaderboard");

      if (bindings.length === 0) {
        logger.info({ action: "daily_leaderboard_skipped", reason: "no_bindings" });
        return;
      }

      for (const binding of bindings) {
        await addNotificationJobForTarget("daily-leaderboard", binding.targetId, binding.id, data);
      }
    }

    logger.info({
      action: "daily_leaderboard_sent",
      entriesCount: data.entries.length,
    });
  } catch (error) {
    logger.error({
      action: "send_daily_leaderboard_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 发送成本预警通知（定时任务调用）
 */
export async function sendCostAlerts(): Promise<void> {
  try {
    const { getNotificationSettings } = await import("@/repository/notifications");
    const settings = await getNotificationSettings();

    if (!settings.enabled || !settings.costAlertEnabled) {
      logger.info({ action: "cost_alert_disabled" });
      return;
    }

    // 生成成本预警数据
    const alerts = await generateCostAlerts(parseFloat(settings.costAlertThreshold || "0.80"));

    if (alerts.length === 0) {
      logger.info({ action: "cost_alert_no_data" });
      return;
    }

    // 动态导入通知队列
    const { addNotificationJob, addNotificationJobForTarget } = await import(
      "./notification-queue"
    );

    if (settings.useLegacyMode) {
      if (!settings.costAlertWebhook) {
        logger.info({ action: "cost_alert_disabled", reason: "legacy_webhook_missing" });
        return;
      }
      for (const alert of alerts) {
        await addNotificationJob("cost-alert", settings.costAlertWebhook, alert);
      }
    } else {
      const { getEnabledBindingsByType } = await import("@/repository/notification-bindings");
      const bindings = await getEnabledBindingsByType("cost_alert");

      if (bindings.length === 0) {
        logger.info({ action: "cost_alerts_skipped", reason: "no_bindings" });
        return;
      }

      for (const alert of alerts) {
        for (const binding of bindings) {
          await addNotificationJobForTarget("cost-alert", binding.targetId, binding.id, alert);
        }
      }
    }

    logger.info({
      action: "cost_alerts_sent",
      count: alerts.length,
    });
  } catch (error) {
    logger.error({
      action: "send_cost_alerts_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
