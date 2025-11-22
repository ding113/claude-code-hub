"use server";

import { WeChatBot } from "@/lib/wechat/bot";
import { logger } from "@/lib/logger";
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
  type UpdateNotificationSettingsInput,
} from "@/repository/notifications";

/**
 * 检查 URL 是否指向内部/私有网络（SSRF 防护）
 */
function isInternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // 阻止 localhost 和 IPv6 loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return true;
    }

    // 解析 IPv4 地址
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b, c] = ipv4Match.map(Number);
      // 私有 IP 范围
      if (a === 127) return true; // 127.0.0.0/8 (loopback range)
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
      if (a === 0) return true; // 0.0.0.0/8
    }

    // 检查 IPv6 私有地址范围
    // 移除方括号（如果存在）用于 IPv6 地址检查
    const ipv6Hostname = hostname.replace(/^\[|\]$/g, "");
    // IPv6-mapped IPv4 loopback (::ffff:127.x.x.x)
    if (
      ipv6Hostname.startsWith("::ffff:127.") ||
      ipv6Hostname.startsWith("::ffff:10.") ||
      ipv6Hostname.startsWith("::ffff:192.168.") ||
      ipv6Hostname.startsWith("::ffff:0.")
    ) {
      return true;
    }
    // IPv6-mapped IPv4 172.16-31.x.x
    const ipv6MappedMatch = ipv6Hostname.match(/^::ffff:172\.(\d+)\./);
    if (ipv6MappedMatch) {
      const secondOctet = parseInt(ipv6MappedMatch[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    // ULA (Unique Local Address): fc00::/7
    if (ipv6Hostname.startsWith("fc") || ipv6Hostname.startsWith("fd")) {
      return true;
    }
    // Link-local: fe80::/10
    if (ipv6Hostname.startsWith("fe80:")) {
      return true;
    }

    // 危险端口
    const dangerousPorts = [22, 23, 3306, 5432, 27017, 6379, 11211];
    if (url.port && dangerousPorts.includes(parseInt(url.port, 10))) {
      return true;
    }

    return false;
  } catch {
    return true; // 无效 URL 视为不安全
  }
}

/**
 * 获取通知设置
 */
export async function getNotificationSettingsAction(): Promise<NotificationSettings> {
  return getNotificationSettings();
}

/**
 * 更新通知设置并重新调度任务
 */
export async function updateNotificationSettingsAction(
  payload: UpdateNotificationSettingsInput
): Promise<{ success: boolean; data?: NotificationSettings; error?: string }> {
  try {
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

    return { success: true, data: updated };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新通知设置失败",
    };
  }
}

/**
 * 测试 Webhook 连通性
 */
export async function testWebhookAction(
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.trim()) {
    return { success: false, error: "Webhook URL 不能为空" };
  }

  const trimmedUrl = webhookUrl.trim();

  // SSRF 防护: 阻止访问内部网络
  if (isInternalUrl(trimmedUrl)) {
    logger.warn({
      action: "webhook_test_blocked",
      reason: "internal_url",
      url: trimmedUrl.replace(/key=[^&]+/, "key=***"), // 脱敏
    });
    return { success: false, error: "不允许访问内部网络地址" };
  }

  try {
    const bot = new WeChatBot(trimmedUrl);
    const result = await bot.testConnection();

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "测试连接失败",
    };
  }
}
