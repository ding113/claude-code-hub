import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";
import { WebhookTargetSchema } from "./webhook-targets";

export const NotificationTypeSchema = z
  .enum(["circuit_breaker", "daily_leaderboard", "cost_alert", "cache_hit_rate_alert"])
  .describe("Notification job type.");

export const NotificationTypeParamSchema = z.object({
  type: NotificationTypeSchema,
});

export const NotificationSettingsSchema = z
  .object({
    id: z.number().int().positive().describe("Settings row id."),
    enabled: z.boolean().describe("Whether notifications are enabled globally."),
    useLegacyMode: z.boolean().describe("Whether legacy single-webhook mode is enabled."),
    circuitBreakerEnabled: z
      .boolean()
      .describe("Whether circuit breaker notifications are enabled."),
    circuitBreakerWebhook: z.string().nullable().describe("Legacy circuit breaker webhook URL."),
    dailyLeaderboardEnabled: z
      .boolean()
      .describe("Whether daily leaderboard notifications are enabled."),
    dailyLeaderboardWebhook: z
      .string()
      .nullable()
      .describe("Legacy daily leaderboard webhook URL."),
    dailyLeaderboardTime: z.string().nullable().describe("Daily leaderboard schedule time."),
    dailyLeaderboardTopN: z.number().int().nullable().describe("Daily leaderboard size."),
    costAlertEnabled: z.boolean().describe("Whether cost alert notifications are enabled."),
    costAlertWebhook: z.string().nullable().describe("Legacy cost alert webhook URL."),
    costAlertThreshold: z.string().nullable().describe("Cost alert threshold as decimal string."),
    costAlertCheckInterval: z
      .number()
      .int()
      .nullable()
      .describe("Cost alert check interval in minutes."),
    cacheHitRateAlertEnabled: z.boolean().describe("Whether cache hit rate alerts are enabled."),
    cacheHitRateAlertWebhook: z
      .string()
      .nullable()
      .describe("Legacy cache hit rate alert webhook URL."),
    cacheHitRateAlertWindowMode: z
      .string()
      .nullable()
      .describe("Cache hit rate alert window mode."),
    cacheHitRateAlertCheckInterval: z
      .number()
      .int()
      .nullable()
      .describe("Cache alert check interval."),
    cacheHitRateAlertHistoricalLookbackDays: z
      .number()
      .int()
      .nullable()
      .describe("Historical lookback days."),
    cacheHitRateAlertMinEligibleRequests: z
      .number()
      .int()
      .nullable()
      .describe("Minimum eligible requests."),
    cacheHitRateAlertMinEligibleTokens: z
      .number()
      .int()
      .nullable()
      .describe("Minimum eligible tokens."),
    cacheHitRateAlertAbsMin: z.string().nullable().describe("Absolute minimum hit rate."),
    cacheHitRateAlertDropRel: z.string().nullable().describe("Relative hit-rate drop threshold."),
    cacheHitRateAlertDropAbs: z.string().nullable().describe("Absolute hit-rate drop threshold."),
    cacheHitRateAlertCooldownMinutes: z
      .number()
      .int()
      .nullable()
      .describe("Alert cooldown in minutes."),
    cacheHitRateAlertTopN: z.number().int().nullable().describe("Top N cache hit-rate alerts."),
    createdAt: IsoDateTimeStringSchema.nullable().describe("Creation time."),
    updatedAt: IsoDateTimeStringSchema.nullable().describe("Last update time."),
  })
  .describe("Notification settings.");

export const NotificationSettingsUpdateSchema = NotificationSettingsSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
  .partial()
  .strict()
  .describe("Notification settings update request.");

export const NotificationTestWebhookRequestSchema = z
  .object({
    webhookUrl: z.string().trim().url().describe("Webhook URL to test."),
    type: NotificationTypeSchema,
  })
  .strict();

export const NotificationTestWebhookResponseSchema = z.object({
  success: z.boolean().describe("Whether the webhook test succeeded."),
  error: z.string().optional().describe("Error message when the test failed."),
});

export const NotificationBindingInputSchema = z
  .object({
    targetId: z.number().int().positive().describe("Webhook target id."),
    isEnabled: z.boolean().optional().describe("Whether this binding is enabled."),
    scheduleCron: z.string().max(100).nullable().optional().describe("Optional cron schedule."),
    scheduleTimezone: z
      .string()
      .max(50)
      .nullable()
      .optional()
      .describe("Optional schedule timezone."),
    templateOverride: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe("Optional template override."),
  })
  .strict();

export const NotificationBindingSchema = z.object({
  id: z.number().int().positive().describe("Binding id."),
  notificationType: NotificationTypeSchema,
  targetId: z.number().int().positive().describe("Webhook target id."),
  isEnabled: z.boolean().describe("Whether this binding is enabled."),
  scheduleCron: z.string().nullable().describe("Optional cron schedule."),
  scheduleTimezone: z.string().nullable().describe("Optional schedule timezone."),
  templateOverride: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe("Optional template override."),
  createdAt: IsoDateTimeStringSchema.nullable().describe("Creation time."),
  target: WebhookTargetSchema.describe("Redacted webhook target."),
});

export const NotificationBindingListResponseSchema = z.object({
  items: z.array(NotificationBindingSchema).describe("Notification bindings for this type."),
});

export const NotificationBindingUpdateSchema = z
  .object({
    items: z.array(NotificationBindingInputSchema).describe("Replacement bindings for this type."),
  })
  .strict();

export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsSchema>;
export type NotificationSettingsUpdateInput = z.infer<typeof NotificationSettingsUpdateSchema>;
export type NotificationBindingResponse = z.infer<typeof NotificationBindingSchema>;
export type NotificationBindingUpdateInput = z.infer<typeof NotificationBindingUpdateSchema>;
