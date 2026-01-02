"use client";

import { z } from "zod";

export const NotificationTypeSchema = z.enum([
  "circuit_breaker",
  "daily_leaderboard",
  "cost_alert",
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const WebhookProviderTypeSchema = z.enum([
  "wechat",
  "feishu",
  "dingtalk",
  "telegram",
  "custom",
]);
export type WebhookProviderType = z.infer<typeof WebhookProviderTypeSchema>;

export const WebhookTargetFormSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    providerType: WebhookProviderTypeSchema,

    webhookUrl: z.string().trim().optional().nullable(),

    telegramBotToken: z.string().trim().optional().nullable(),
    telegramChatId: z.string().trim().optional().nullable(),

    dingtalkSecret: z.string().trim().optional().nullable(),

    customTemplate: z.string().trim().optional().nullable(),
    customHeaders: z.string().trim().optional().nullable(),

    proxyUrl: z.string().trim().optional().nullable(),
    proxyFallbackToDirect: z.boolean().default(false),

    isEnabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const webhookUrl = value.webhookUrl?.trim();
    const telegramBotToken = value.telegramBotToken?.trim();
    const telegramChatId = value.telegramChatId?.trim();

    if (value.providerType === "telegram") {
      if (!telegramBotToken) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telegram Bot Token 不能为空",
          path: ["telegramBotToken"],
        });
      }
      if (!telegramChatId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telegram Chat ID 不能为空",
          path: ["telegramChatId"],
        });
      }
      return;
    }

    if (!webhookUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Webhook URL 不能为空",
        path: ["webhookUrl"],
      });
      return;
    }

    try {
      // eslint-disable-next-line no-new
      new URL(webhookUrl);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Webhook URL 格式不正确",
        path: ["webhookUrl"],
      });
    }

    if (value.providerType === "custom") {
      const template = value.customTemplate?.trim();
      if (!template) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "自定义模板不能为空",
          path: ["customTemplate"],
        });
        return;
      }
      try {
        const parsed = JSON.parse(template) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "自定义模板必须是 JSON 对象",
            path: ["customTemplate"],
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "自定义模板不是有效 JSON",
          path: ["customTemplate"],
        });
      }
    }

    const headers = value.customHeaders?.trim();
    if (headers) {
      try {
        const parsed = JSON.parse(headers) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Headers 必须是 JSON 对象",
            path: ["customHeaders"],
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Headers 不是有效 JSON",
          path: ["customHeaders"],
        });
      }
    }
  });

export type WebhookTargetFormValues = z.input<typeof WebhookTargetFormSchema>;
