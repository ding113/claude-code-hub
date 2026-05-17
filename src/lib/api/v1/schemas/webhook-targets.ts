import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const WebhookProviderTypeSchema = z
  .enum(["wechat", "feishu", "dingtalk", "telegram", "custom"])
  .describe("Webhook provider type.");

export const WebhookNotificationTypeSchema = z
  .enum(["circuit_breaker", "daily_leaderboard", "cost_alert", "cache_hit_rate_alert"])
  .describe("Notification type used for sending a test webhook message.");

export const WebhookTestResultSchema = z
  .object({
    success: z.boolean().describe("Whether the last test succeeded."),
    error: z.string().optional().describe("Last test error message, when failed."),
    latencyMs: z.number().optional().describe("Last test latency in milliseconds."),
  })
  .describe("Last webhook test result.");

export const WebhookTargetSchema = z.object({
  id: z.number().int().positive().describe("Webhook target id."),
  name: z.string().describe("Webhook target display name."),
  providerType: WebhookProviderTypeSchema,
  webhookUrl: z.string().nullable().describe("Webhook URL. Null for Telegram targets."),
  telegramBotToken: z
    .null()
    .openapi({ readOnly: true })
    .describe("Telegram bot token is write-only and redacted in responses."),
  telegramChatId: z.string().nullable().describe("Telegram chat id."),
  dingtalkSecret: z
    .null()
    .openapi({ readOnly: true })
    .describe("DingTalk secret is write-only and redacted in responses."),
  customTemplate: z.record(z.string(), z.unknown()).nullable().describe("Custom webhook template."),
  customHeaders: z.record(z.string(), z.string()).nullable().describe("Custom webhook headers."),
  proxyUrl: z.string().nullable().describe("Optional proxy URL."),
  proxyFallbackToDirect: z
    .boolean()
    .describe("Whether failed proxy calls fall back to direct calls."),
  isEnabled: z.boolean().describe("Whether this target is enabled."),
  lastTestAt: IsoDateTimeStringSchema.nullable().describe("Last test time."),
  lastTestResult: WebhookTestResultSchema.nullable().describe("Last test result."),
  createdAt: IsoDateTimeStringSchema.nullable().describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.nullable().describe("Last update time."),
});

export const WebhookTargetListResponseSchema = z.object({
  items: z.array(WebhookTargetSchema).describe("Webhook targets."),
});

export const WebhookTargetCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe("Webhook target display name."),
    providerType: WebhookProviderTypeSchema,
    webhookUrl: z.string().trim().url().optional().nullable().describe("Webhook URL."),
    telegramBotToken: z
      .string()
      .trim()
      .optional()
      .nullable()
      .openapi({ description: "Write-only Telegram bot token.", writeOnly: true }),
    telegramChatId: z.string().trim().optional().nullable().describe("Telegram chat id."),
    dingtalkSecret: z
      .string()
      .trim()
      .optional()
      .nullable()
      .openapi({ description: "Write-only DingTalk signing secret.", writeOnly: true }),
    customTemplate: z
      .union([z.string().trim(), z.record(z.string(), z.unknown())])
      .optional()
      .nullable()
      .describe("Custom webhook template."),
    customHeaders: z
      .record(z.string(), z.string())
      .optional()
      .nullable()
      .describe("Custom webhook headers."),
    proxyUrl: z.string().trim().optional().nullable().describe("Optional proxy URL."),
    proxyFallbackToDirect: z
      .boolean()
      .optional()
      .describe("Fallback to direct call when proxy fails."),
    isEnabled: z.boolean().optional().describe("Whether this target is enabled."),
  })
  .strict();

const RedactedWebhookUrlSchema = z
  .literal("[REDACTED]")
  .describe("Redacted webhook URL placeholder from read responses. Preserves the stored value.");

export const WebhookTargetUpdateSchema = WebhookTargetCreateSchema.extend({
  webhookUrl: z
    .union([z.string().trim().url(), RedactedWebhookUrlSchema])
    .optional()
    .nullable()
    .describe("Webhook URL. The redacted placeholder preserves the stored value."),
})
  .partial()
  .strict();

export const WebhookTargetIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Webhook target id."),
});

export const WebhookTargetTestRequestSchema = z
  .object({
    notificationType: WebhookNotificationTypeSchema,
  })
  .strict();

export const WebhookTargetTestResponseSchema = z.object({
  latencyMs: z.number().describe("Webhook test latency in milliseconds."),
});

export type WebhookTargetResponse = z.infer<typeof WebhookTargetSchema>;
export type WebhookTargetCreateInput = z.infer<typeof WebhookTargetCreateSchema>;
export type WebhookTargetUpdateInput = z.infer<typeof WebhookTargetUpdateSchema>;
