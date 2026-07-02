"use server";

import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { resolveSystemTimezone } from "@/lib/utils/timezone-resolver";
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

    const scheduleNotificationsModulePromise = import("@/lib/notification/notification-queue");
    // react-doctor-disable-next-line react-doctor/async-parallel -- audit needs the pre-update snapshot before applying the mutation
    const before = await getNotificationSettings();
    const updated = await updateNotificationSettings(payload);

    // 重新调度通知任务，使总开关、子开关、时间/间隔等变更立即生效（添加/移除 repeatable 作业）。
    // 动态导入避免静态加载 Bull；scheduleNotifications 内部已 fail-open，缺少 REDIS_URL 时不会影响设置保存。
    const { scheduleNotifications } = await scheduleNotificationsModulePromise;
    await scheduleNotifications();

    emitActionAudit({
      category: "notification",
      action: "notification.update",
      targetType: "notification",
      before,
      after: updated,
      success: true,
    });
    return { ok: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新通知设置失败";
    emitActionAudit({
      category: "notification",
      action: "notification.update",
      targetType: "notification",
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return {
      ok: false,
      error: message,
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

  if (!webhookUrl?.trim()) {
    return { success: false, error: "Webhook URL 不能为空" };
  }

  const trimmedUrl = webhookUrl.trim();

  try {
    const notifier = new WebhookNotifier(trimmedUrl, { maxRetries: 1 });
    const timezone = await resolveSystemTimezone();
    const testMessage = buildTestMessage(type, timezone);
    return notifier.send(testMessage, { timezone });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "测试连接失败",
    };
  }
}
