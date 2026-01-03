/**
 * Webhook 迁移工具
 *
 * 用于将旧的单 URL 配置迁移到新的多目标 Webhook 系统。
 */

import { updateBindingsAction } from "@/actions/notification-bindings";
import { createWebhookTargetAction } from "@/actions/webhook-targets";
import { logger } from "@/lib/logger";
import type { NotificationType } from "@/repository/notification-bindings";
import type { NotificationSettings } from "@/repository/notifications";
import type { WebhookProviderType } from "@/repository/webhook-targets";

/**
 * 待迁移的 Webhook 信息
 */
export interface LegacyWebhookInfo {
  url: string;
  notificationTypes: NotificationType[];
  detectedProvider: WebhookProviderType | null;
}

/**
 * 迁移结果
 */
export interface MigrationResult {
  success: boolean;
  error?: string;
  createdTargets: number;
  createdBindings: number;
}

/**
 * 自动检测 Webhook URL 的平台类型
 *
 * @param url - Webhook URL
 * @returns 检测到的平台类型，无法识别时返回 null
 */
export function detectProviderType(url: string): WebhookProviderType | null {
  if (!url) {
    return null;
  }

  const normalizedUrl = url.toLowerCase();

  // 企业微信
  if (normalizedUrl.includes("qyapi.weixin.qq.com")) {
    return "wechat";
  }

  // 飞书（包括国际版 Lark）
  if (normalizedUrl.includes("open.feishu.cn") || normalizedUrl.includes("larksuite.com")) {
    return "feishu";
  }

  // 钉钉
  if (normalizedUrl.includes("oapi.dingtalk.com")) {
    return "dingtalk";
  }

  // Telegram
  if (normalizedUrl.includes("api.telegram.org")) {
    return "telegram";
  }

  // 无法识别，需要用户手动选择
  return null;
}

/**
 * 从旧配置中收集需要迁移的 Webhook
 *
 * @param settings - 旧的通知设置
 * @returns 待迁移的 Webhook 列表（相同 URL 会合并通知类型）
 */
export function collectLegacyWebhooks(settings: NotificationSettings): LegacyWebhookInfo[] {
  // 使用 Map 按 URL 聚合，合并相同 URL 的不同通知类型
  const webhookMap = new Map<string, LegacyWebhookInfo>();

  const addWebhook = (url: string | null, type: NotificationType) => {
    if (!url || !url.trim()) {
      return;
    }

    const trimmedUrl = url.trim();
    const existing = webhookMap.get(trimmedUrl);

    if (existing) {
      if (!existing.notificationTypes.includes(type)) {
        existing.notificationTypes.push(type);
      }
    } else {
      webhookMap.set(trimmedUrl, {
        url: trimmedUrl,
        notificationTypes: [type],
        detectedProvider: detectProviderType(trimmedUrl),
      });
    }
  };

  // 收集熔断器告警 Webhook
  if (settings.circuitBreakerEnabled && settings.circuitBreakerWebhook) {
    addWebhook(settings.circuitBreakerWebhook, "circuit_breaker");
  }

  // 收集每日排行榜 Webhook
  if (settings.dailyLeaderboardEnabled && settings.dailyLeaderboardWebhook) {
    addWebhook(settings.dailyLeaderboardWebhook, "daily_leaderboard");
  }

  // 收集成本预警 Webhook
  if (settings.costAlertEnabled && settings.costAlertWebhook) {
    addWebhook(settings.costAlertWebhook, "cost_alert");
  }

  return Array.from(webhookMap.values());
}

/**
 * 生成 Webhook 目标名称
 *
 * @param providerType - 平台类型
 * @param index - 索引（用于多个相同类型时区分）
 */
function generateTargetName(providerType: WebhookProviderType, index: number): string {
  // Use English names for database storage (display names handled by i18n in UI)
  const providerNames: Record<WebhookProviderType, string> = {
    wechat: "WeChat Work",
    feishu: "Feishu",
    dingtalk: "DingTalk",
    telegram: "Telegram",
    custom: "Custom Webhook",
  };

  const baseName = providerNames[providerType] || "Webhook";
  return index > 0 ? `${baseName} (${index + 1})` : baseName;
}

/**
 * 执行迁移，将旧配置迁移到新的 Webhook 系统
 *
 * @param settings - 旧的通知设置
 * @param platformSelections - 手动选择的平台类型映射（URL -> WebhookProviderType）
 * @returns 迁移结果
 */
export async function migrateToNewWebhookSystem(
  settings: NotificationSettings,
  platformSelections: Map<string, WebhookProviderType>
): Promise<MigrationResult> {
  // 统计创建计数器：放在 try 外，保证异常时也能返回已完成的部分进度
  let createdTargets = 0;
  let createdBindings = 0;

  try {
    // 收集需要迁移的 Webhook
    const legacyWebhooks = collectLegacyWebhooks(settings);

    if (legacyWebhooks.length === 0) {
      return {
        success: true,
        createdTargets,
        createdBindings,
      };
    }

    // 按平台类型统计，用于生成唯一名称
    const providerCounters = new Map<WebhookProviderType, number>();

    // URL -> targetId 映射，用于创建绑定
    const urlToTargetId = new Map<string, number>();

    // 第一步：为每个唯一 URL 创建 Webhook 目标
    for (const webhook of legacyWebhooks) {
      // 确定平台类型：优先使用手动选择，其次使用自动检测，最后使用 custom
      let providerType = webhook.detectedProvider;

      if (!providerType) {
        const manualSelection = platformSelections.get(webhook.url);
        if (manualSelection) {
          providerType = manualSelection;
        } else {
          // 未检测到且未手动选择，跳过此 Webhook（需要用户手动选择）
          logger.warn(
            "Webhook migration skipped: unrecognized provider type and no manual selection"
          );
          continue;
        }
      }

      // 生成唯一名称
      const counter = providerCounters.get(providerType) || 0;
      const targetName = generateTargetName(providerType, counter);
      providerCounters.set(providerType, counter + 1);

      // 创建 Webhook 目标
      const createResult = await createWebhookTargetAction({
        name: targetName,
        providerType,
        webhookUrl: webhook.url,
        isEnabled: true,
      });

      if (!createResult.ok) {
        logger.error("Failed to create webhook target", {
          error: createResult.error,
        });
        return {
          success: false,
          error: `CREATE_TARGET_FAILED:${createResult.error}`,
          createdTargets,
          createdBindings,
        };
      }

      urlToTargetId.set(webhook.url, createResult.data.id);
      createdTargets++;

      logger.debug("Migration: webhook target created successfully", {
        targetId: createResult.data.id,
        name: targetName,
        providerType,
      });
    }

    // 第二步：为每个通知类型创建绑定
    // 按通知类型聚合所有需要绑定的目标
    const bindingsByType = new Map<NotificationType, number[]>();

    for (const webhook of legacyWebhooks) {
      const targetId = urlToTargetId.get(webhook.url);
      if (!targetId) {
        // 跳过未成功创建目标的 Webhook
        continue;
      }

      for (const notificationType of webhook.notificationTypes) {
        const existing = bindingsByType.get(notificationType) || [];
        if (!existing.includes(targetId)) {
          existing.push(targetId);
          bindingsByType.set(notificationType, existing);
        }
      }
    }

    // 为每个通知类型创建绑定
    for (const [notificationType, targetIds] of bindingsByType) {
      const bindings = targetIds.map((targetId) => ({
        targetId,
        isEnabled: true,
      }));

      const bindResult = await updateBindingsAction(notificationType, bindings);

      if (!bindResult.ok) {
        logger.error("Failed to create notification binding", {
          notificationType,
          targetIds,
          error: bindResult.error,
        });
        return {
          success: false,
          error: `CREATE_BINDING_FAILED:${bindResult.error}`,
          createdTargets,
          createdBindings,
        };
      }

      createdBindings += targetIds.length;

      logger.debug("Migration: notification bindings created successfully", {
        notificationType,
        targetIds,
      });
    }

    return {
      success: true,
      createdTargets,
      createdBindings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Webhook migration failed", { error });
    return {
      success: false,
      error: message,
      createdTargets,
      createdBindings,
    };
  }
}

/**
 * 检查是否有需要迁移的旧 Webhook 配置
 *
 * @param settings - 通知设置
 * @returns 是否有需要迁移的配置
 */
export function hasLegacyWebhooks(settings: NotificationSettings): boolean {
  return collectLegacyWebhooks(settings).length > 0;
}

/**
 * 获取需要手动选择平台的 Webhook URL 列表
 *
 * @param settings - 通知设置
 * @returns 无法自动识别平台的 URL 列表
 */
export function getUndetectedWebhooks(settings: NotificationSettings): string[] {
  const webhooks = collectLegacyWebhooks(settings);
  return webhooks.filter((w) => w.detectedProvider === null).map((w) => w.url);
}
