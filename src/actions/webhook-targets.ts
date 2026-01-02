"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { logger } from "@/lib/logger";
import { isValidProxyUrl } from "@/lib/proxy-agent";
import { WebhookNotifier } from "@/lib/webhook";
import { buildTestMessage } from "@/lib/webhook/templates/test-messages";
import { getNotificationSettings, updateNotificationSettings } from "@/repository/notifications";
import {
  createWebhookTarget,
  deleteWebhookTarget,
  getAllWebhookTargets,
  getWebhookTargetById,
  updateTestResult,
  updateWebhookTarget,
  type WebhookProviderType,
  type WebhookTarget,
} from "@/repository/webhook-targets";
import type { ActionResult } from "./types";

/**
 * SSRF 防护：阻止访问内部/私有网络地址
 *
 * 说明：代理地址不做此限制（Telegram 在部分环境需要本地代理）。
 */
function isInternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return true;
    }

    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }

    const ipv6Hostname = hostname.replace(/^\[|\]$/g, "");
    if (
      ipv6Hostname.startsWith("::ffff:127.") ||
      ipv6Hostname.startsWith("::ffff:10.") ||
      ipv6Hostname.startsWith("::ffff:192.168.") ||
      ipv6Hostname.startsWith("::ffff:0.")
    ) {
      return true;
    }
    const ipv6MappedMatch = ipv6Hostname.match(/^::ffff:172\.(\d+)\./);
    if (ipv6MappedMatch) {
      const secondOctet = parseInt(ipv6MappedMatch[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    if (ipv6Hostname.startsWith("fc") || ipv6Hostname.startsWith("fd")) {
      return true;
    }
    if (ipv6Hostname.startsWith("fe80:")) {
      return true;
    }

    const dangerousPorts = [22, 23, 3306, 5432, 27017, 6379, 11211];
    if (url.port && dangerousPorts.includes(parseInt(url.port, 10))) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseCustomTemplate(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = trimToNull(value);
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("自定义模板必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

const ProviderTypeSchema = z.enum(["wechat", "feishu", "dingtalk", "telegram", "custom"]);
const NotificationTypeSchema = z.enum(["circuit_breaker", "daily_leaderboard", "cost_alert"]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

const BaseTargetSchema = z.object({
  name: z.string().trim().min(1, "目标名称不能为空").max(100, "目标名称不能超过100个字符"),
  providerType: ProviderTypeSchema,

  webhookUrl: z.string().trim().url("Webhook URL 格式不正确").optional().nullable(),

  telegramBotToken: z.string().trim().min(1, "Telegram Bot Token 不能为空").optional().nullable(),
  telegramChatId: z.string().trim().min(1, "Telegram Chat ID 不能为空").optional().nullable(),

  dingtalkSecret: z.string().trim().optional().nullable(),

  customTemplate: z.string().trim().optional().nullable(),
  customHeaders: z.record(z.string(), z.string()).optional().nullable(),

  proxyUrl: z.string().trim().optional().nullable(),
  proxyFallbackToDirect: z.boolean().optional(),

  isEnabled: z.boolean().optional(),
});

const UpdateTargetSchema = BaseTargetSchema.partial();

function normalizeTargetInput(input: z.infer<typeof BaseTargetSchema>): {
  name: string;
  providerType: WebhookProviderType;
  webhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  dingtalkSecret: string | null;
  customTemplate: Record<string, unknown> | null;
  customHeaders: Record<string, string> | null;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  isEnabled: boolean;
} {
  const providerType = input.providerType as WebhookProviderType;

  const webhookUrl = trimToNull(input.webhookUrl);
  const telegramBotToken = trimToNull(input.telegramBotToken);
  const telegramChatId = trimToNull(input.telegramChatId);
  const dingtalkSecret = trimToNull(input.dingtalkSecret);
  const proxyUrl = trimToNull(input.proxyUrl);

  if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
    throw new Error("代理地址格式不正确（支持 http:// https:// socks5:// socks4://）");
  }

  if (providerType === "telegram") {
    if (!telegramBotToken || !telegramChatId) {
      throw new Error("Telegram 需要 Bot Token 和 Chat ID");
    }
  } else {
    if (!webhookUrl) {
      throw new Error("Webhook URL 不能为空");
    }
    if (isInternalUrl(webhookUrl)) {
      throw new Error("不允许访问内部网络地址");
    }
  }

  const customTemplate =
    providerType === "custom" ? parseCustomTemplate(input.customTemplate) : null;
  if (providerType === "custom" && !customTemplate) {
    throw new Error("自定义 Webhook 需要配置模板");
  }

  return {
    name: input.name.trim(),
    providerType,
    webhookUrl: providerType === "telegram" ? null : webhookUrl,
    telegramBotToken: providerType === "telegram" ? telegramBotToken : null,
    telegramChatId: providerType === "telegram" ? telegramChatId : null,
    dingtalkSecret: providerType === "dingtalk" ? dingtalkSecret : null,
    customTemplate: providerType === "custom" ? customTemplate : null,
    customHeaders: providerType === "custom" ? (input.customHeaders ?? null) : null,
    proxyUrl,
    proxyFallbackToDirect: input.proxyFallbackToDirect ?? false,
    isEnabled: input.isEnabled ?? true,
  };
}

function normalizeTargetUpdateInput(
  existing: WebhookTarget,
  input: z.infer<typeof UpdateTargetSchema>
): {
  name: string;
  providerType: WebhookProviderType;
  webhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  dingtalkSecret: string | null;
  customTemplate: Record<string, unknown> | null;
  customHeaders: Record<string, string> | null;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  isEnabled: boolean;
} {
  const providerType = (input.providerType ?? existing.providerType) as WebhookProviderType;

  const webhookUrl =
    input.webhookUrl !== undefined ? trimToNull(input.webhookUrl) : existing.webhookUrl;
  const telegramBotToken =
    input.telegramBotToken !== undefined
      ? trimToNull(input.telegramBotToken)
      : existing.telegramBotToken;
  const telegramChatId =
    input.telegramChatId !== undefined ? trimToNull(input.telegramChatId) : existing.telegramChatId;
  const dingtalkSecret =
    input.dingtalkSecret !== undefined ? trimToNull(input.dingtalkSecret) : existing.dingtalkSecret;
  const proxyUrl = input.proxyUrl !== undefined ? trimToNull(input.proxyUrl) : existing.proxyUrl;

  const customTemplate =
    providerType === "custom"
      ? input.customTemplate !== undefined
        ? parseCustomTemplate(input.customTemplate)
        : existing.customTemplate
      : null;
  const customHeaders =
    providerType === "custom"
      ? input.customHeaders !== undefined
        ? input.customHeaders
        : existing.customHeaders
      : null;

  if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
    throw new Error("代理地址格式不正确（支持 http:// https:// socks5:// socks4://）");
  }

  if (providerType === "telegram") {
    if (!telegramBotToken || !telegramChatId) {
      throw new Error("Telegram 需要 Bot Token 和 Chat ID");
    }
  } else {
    if (!webhookUrl) {
      throw new Error("Webhook URL 不能为空");
    }
    if (isInternalUrl(webhookUrl)) {
      throw new Error("不允许访问内部网络地址");
    }
  }

  if (providerType === "custom" && !customTemplate) {
    throw new Error("自定义 Webhook 需要配置模板");
  }

  return {
    name: input.name !== undefined ? input.name.trim() : existing.name,
    providerType,
    webhookUrl: providerType === "telegram" ? null : webhookUrl,
    telegramBotToken: providerType === "telegram" ? telegramBotToken : null,
    telegramChatId: providerType === "telegram" ? telegramChatId : null,
    dingtalkSecret: providerType === "dingtalk" ? dingtalkSecret : null,
    customTemplate: providerType === "custom" ? customTemplate : null,
    customHeaders: providerType === "custom" ? customHeaders : null,
    proxyUrl,
    proxyFallbackToDirect:
      input.proxyFallbackToDirect !== undefined
        ? input.proxyFallbackToDirect
        : existing.proxyFallbackToDirect,
    isEnabled: input.isEnabled !== undefined ? input.isEnabled : existing.isEnabled,
  };
}

function toJobType(type: NotificationType): NotificationJobType {
  switch (type) {
    case "circuit_breaker":
      return "circuit-breaker";
    case "daily_leaderboard":
      return "daily-leaderboard";
    case "cost_alert":
      return "cost-alert";
  }
}

function buildTestData(type: NotificationType): unknown {
  switch (type) {
    case "circuit_breaker":
      return {
        providerName: "测试供应商",
        providerId: 0,
        failureCount: 3,
        retryAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        lastError: "Connection timeout (示例错误)",
      };
    case "daily_leaderboard":
      return {
        date: new Date().toISOString().split("T")[0],
        entries: [
          { userId: 1, userName: "用户A", totalRequests: 150, totalCost: 12.5, totalTokens: 50000 },
          { userId: 2, userName: "用户B", totalRequests: 120, totalCost: 10.2, totalTokens: 40000 },
        ],
        totalRequests: 270,
        totalCost: 22.7,
      };
    case "cost_alert":
      return {
        targetType: "user",
        targetName: "测试用户",
        targetId: 0,
        currentCost: 80,
        quotaLimit: 100,
        threshold: 0.8,
        period: "本月",
      };
  }
}

export async function getWebhookTargetsAction(): Promise<ActionResult<WebhookTarget[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限访问推送目标" };
    }

    const targets = await getAllWebhookTargets();
    return { ok: true, data: targets };
  } catch (error) {
    logger.error("获取推送目标失败:", error);
    return { ok: false, error: "获取推送目标失败" };
  }
}

export async function createWebhookTargetAction(
  input: z.infer<typeof BaseTargetSchema>
): Promise<ActionResult<WebhookTarget>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = BaseTargetSchema.parse(input);
    const normalized = normalizeTargetInput(validated);

    const created = await createWebhookTarget(normalized);

    // 数据迁移策略：当创建第一个 webhook_target 时，自动切换到新模式
    const settings = await getNotificationSettings();
    if (settings.useLegacyMode) {
      await updateNotificationSettings({ useLegacyMode: false });
    }

    return { ok: true, data: created };
  } catch (error) {
    logger.error("创建推送目标失败:", error);
    const message = error instanceof Error ? error.message : "创建推送目标失败";
    return { ok: false, error: message };
  }
}

export async function updateWebhookTargetAction(
  id: number,
  input: z.infer<typeof UpdateTargetSchema>
): Promise<ActionResult<WebhookTarget>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const existing = await getWebhookTargetById(id);
    if (!existing) {
      return { ok: false, error: "推送目标不存在" };
    }

    const validated = UpdateTargetSchema.parse(input);
    const normalized = normalizeTargetUpdateInput(existing, validated);

    const updated = await updateWebhookTarget(id, normalized);
    return { ok: true, data: updated };
  } catch (error) {
    logger.error("更新推送目标失败:", error);
    const message = error instanceof Error ? error.message : "更新推送目标失败";
    return { ok: false, error: message };
  }
}

export async function deleteWebhookTargetAction(id: number): Promise<ActionResult<void>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    await deleteWebhookTarget(id);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("删除推送目标失败:", error);
    const message = error instanceof Error ? error.message : "删除推送目标失败";
    return { ok: false, error: message };
  }
}

export async function testWebhookTargetAction(
  id: number,
  notificationType: NotificationType
): Promise<ActionResult<{ latencyMs: number }>> {
  const start = Date.now();

  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const target = await getWebhookTargetById(id);
    if (!target) {
      return { ok: false, error: "推送目标不存在" };
    }

    const validatedType = NotificationTypeSchema.parse(notificationType);
    const testMessage = buildTestMessage(toJobType(validatedType));

    const notifier = new WebhookNotifier(target);
    const result = await notifier.send(testMessage, {
      notificationType: validatedType,
      data: buildTestData(validatedType),
    });

    const latencyMs = Date.now() - start;
    await updateTestResult(id, {
      success: result.success,
      error: result.error,
      latencyMs,
    });

    if (!result.success) {
      return { ok: false, error: result.error || "测试失败" };
    }

    return { ok: true, data: { latencyMs } };
  } catch (error) {
    const latencyMs = Date.now() - start;
    try {
      await updateTestResult(id, {
        success: false,
        error: error instanceof Error ? error.message : "测试失败",
        latencyMs,
      });
    } catch (_e) {
      // 忽略写回失败
    }

    logger.error("测试推送目标失败:", error);
    const message = error instanceof Error ? error.message : "测试推送目标失败";
    return { ok: false, error: message };
  }
}
