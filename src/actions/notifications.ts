"use server";

import { getSession } from "@/lib/auth";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { logger } from "@/lib/logger";
import { WebhookNotifier } from "@/lib/webhook";
import { buildTestMessage } from "@/lib/webhook/templates/test-messages";
import {
  getNotificationSettings,
  type NotificationSettings,
  type UpdateNotificationSettingsInput,
  updateNotificationSettings,
} from "@/repository/notifications";
import type { ActionResult } from "./types";

/**
 * 获取通知设置
 */
export async function getNotificationSettingsAction(): Promise<NotificationSettings> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    throw new Error("无权限执行此操作");
  }
  return getNotificationSettings();
}

/**
 * 更新通知设置并重新调度任务
 */
export async function updateNotificationSettingsAction(
  payload: UpdateNotificationSettingsInput
): Promise<ActionResult<NotificationSettings>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const updated = await updateNotificationSettings(payload);

    // 重新调度通知任务（仅生产环境）
    if (process.env.NODE_ENV === "production") {
      // 动态导入避免 Turbopack 编译 Bull 模块
      const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
      await scheduleNotifications();
    } else {
      logger.warn({
        action: "schedule_notifications_skipped",
        reason: "development_mode",
        message: "Notification scheduling is disabled in development mode",
      });
    }

    return { ok: true, data: updated };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "更新通知设置失败",
    };
  }
}

/**
 * 测试 Webhook 连通性
 */
export async function testWebhookAction(
  webhookUrl: string,
  type: NotificationJobType
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { success: false, error: "无权限执行此操作" };
  }

  if (!webhookUrl || !webhookUrl.trim()) {
    return { success: false, error: "Webhook URL 不能为空" };
  }

  const trimmedUrl = webhookUrl.trim();

  try {
    const notifier = new WebhookNotifier(trimmedUrl, { maxRetries: 1 });
    const testMessage = buildTestMessage(type);
    return notifier.send(testMessage);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "测试连接失败",
    };
  }
}
