/**
 * /api/v1 notifications 资源 schema
 *
 * 设计要点：
 * - 输出 schema 沿用 NotificationSettings 接口（含熔断器 / 排行榜 / 成本 / 缓存命中率四组配置）；
 * - 输入 schema 与 UpdateNotificationSettingsInput 一一对应，所有字段可选；
 * - testWebhook 端点请求体是 (webhookUrl, type) 二元组，type 限定为 NotificationJobType。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 公共枚举 ====================

export const CacheHitRateAlertWindowModeSchema = z
  .enum(["auto", "5m", "30m", "1h", "1.5h"])
  .describe("缓存命中率告警窗口模式")
  .openapi({ example: "auto" });

export const NotificationJobTypeSchema = z
  .enum(["circuit-breaker", "cache-hit-rate-alert", "cost-alert", "daily-leaderboard"])
  .describe("通知任务类型")
  .openapi({ example: "circuit-breaker" });

export type NotificationJobType = z.infer<typeof NotificationJobTypeSchema>;

// ==================== 输出：通知设置 ====================

export const NotificationSettingsResponseSchema = z
  .object({
    id: z.number().int().describe("行主键").openapi({ example: 1 }),
    enabled: z.boolean().describe("总开关").openapi({ example: true }),
    useLegacyMode: z
      .boolean()
      .describe("是否使用 legacy 模式（旧版 webhook 配置）")
      .openapi({ example: false }),

    circuitBreakerEnabled: z.boolean().describe("熔断器告警开关").openapi({ example: true }),
    circuitBreakerWebhook: z
      .string()
      .nullable()
      .describe("熔断器 webhook URL（legacy）")
      .openapi({ example: null }),

    dailyLeaderboardEnabled: z.boolean().describe("每日排行榜开关").openapi({ example: false }),
    dailyLeaderboardWebhook: z
      .string()
      .nullable()
      .describe("每日排行榜 webhook URL（legacy）")
      .openapi({ example: null }),
    dailyLeaderboardTime: z
      .string()
      .nullable()
      .describe("每日推送时间 HH:mm")
      .openapi({ example: "09:00" }),
    dailyLeaderboardTopN: z
      .number()
      .int()
      .nullable()
      .describe("排行榜 TopN")
      .openapi({ example: 10 }),

    costAlertEnabled: z.boolean().describe("成本告警开关").openapi({ example: false }),
    costAlertWebhook: z
      .string()
      .nullable()
      .describe("成本告警 webhook URL（legacy）")
      .openapi({ example: null }),
    costAlertThreshold: z
      .string()
      .nullable()
      .describe("成本告警阈值（USD，numeric 字符串）")
      .openapi({ example: "100.00" }),
    costAlertCheckInterval: z
      .number()
      .int()
      .nullable()
      .describe("成本告警检查间隔（秒）")
      .openapi({ example: 3600 }),

    cacheHitRateAlertEnabled: z
      .boolean()
      .describe("缓存命中率告警开关")
      .openapi({ example: false }),
    cacheHitRateAlertWebhook: z
      .string()
      .nullable()
      .describe("缓存命中率告警 webhook URL（legacy）")
      .openapi({ example: null }),
    cacheHitRateAlertWindowMode: CacheHitRateAlertWindowModeSchema.nullable(),
    cacheHitRateAlertCheckInterval: z
      .number()
      .int()
      .nullable()
      .describe("检查间隔（秒）")
      .openapi({ example: 600 }),
    cacheHitRateAlertHistoricalLookbackDays: z.number().int().nullable().describe("历史回溯天数"),
    cacheHitRateAlertMinEligibleRequests: z.number().int().nullable().describe("最小请求阈值"),
    cacheHitRateAlertMinEligibleTokens: z.number().int().nullable().describe("最小 token 阈值"),
    cacheHitRateAlertAbsMin: z.string().nullable().describe("最小绝对命中率"),
    cacheHitRateAlertDropRel: z.string().nullable().describe("相对下降阈值"),
    cacheHitRateAlertDropAbs: z.string().nullable().describe("绝对下降阈值"),
    cacheHitRateAlertCooldownMinutes: z.number().int().nullable().describe("冷却时长（分钟）"),
    cacheHitRateAlertTopN: z.number().int().nullable().describe("Top N"),

    createdAt: IsoDateTimeSchema.describe("创建时间（ISO 字符串）"),
    updatedAt: IsoDateTimeSchema.describe("更新时间（ISO 字符串）"),
  })
  .describe("通知设置响应");

export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsResponseSchema>;

// ==================== 输入：更新通知设置 ====================

export const NotificationSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    useLegacyMode: z.boolean().optional(),

    circuitBreakerEnabled: z.boolean().optional(),
    circuitBreakerWebhook: z.string().url().nullable().optional().describe("legacy webhook URL"),

    dailyLeaderboardEnabled: z.boolean().optional(),
    dailyLeaderboardWebhook: z.string().url().nullable().optional(),
    dailyLeaderboardTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "推送时间必须为 HH:mm")
      .optional(),
    dailyLeaderboardTopN: z.number().int().min(1).max(100).optional(),

    costAlertEnabled: z.boolean().optional(),
    costAlertWebhook: z.string().url().nullable().optional(),
    costAlertThreshold: z.string().optional().describe("阈值（numeric 字符串）"),
    costAlertCheckInterval: z.number().int().min(60).optional(),

    cacheHitRateAlertEnabled: z.boolean().optional(),
    cacheHitRateAlertWebhook: z.string().url().nullable().optional(),
    cacheHitRateAlertWindowMode: CacheHitRateAlertWindowModeSchema.optional(),
    cacheHitRateAlertCheckInterval: z.number().int().min(60).optional(),
    cacheHitRateAlertHistoricalLookbackDays: z.number().int().min(1).optional(),
    cacheHitRateAlertMinEligibleRequests: z.number().int().min(0).optional(),
    cacheHitRateAlertMinEligibleTokens: z.number().int().min(0).optional(),
    cacheHitRateAlertAbsMin: z.string().optional(),
    cacheHitRateAlertDropRel: z.string().optional(),
    cacheHitRateAlertDropAbs: z.string().optional(),
    cacheHitRateAlertCooldownMinutes: z.number().int().min(0).optional(),
    cacheHitRateAlertTopN: z.number().int().min(1).optional(),
  })
  .describe("更新通知设置请求体（局部更新；所有字段可选）");

export type NotificationSettingsUpdateInput = z.infer<typeof NotificationSettingsUpdateSchema>;

// ==================== 输入 / 输出：测试 webhook ====================

export const TestWebhookRequestSchema = z
  .object({
    webhookUrl: z
      .string()
      .url("Webhook URL 格式不正确")
      .describe("待测试的 Webhook URL")
      .openapi({ example: "https://example.com/webhook" }),
    type: NotificationJobTypeSchema,
  })
  .describe("测试 webhook 请求体");

export type TestWebhookRequest = z.infer<typeof TestWebhookRequestSchema>;

export const TestWebhookResponseSchema = z
  .object({
    success: z.boolean().describe("是否成功").openapi({ example: true }),
    error: z
      .string()
      .optional()
      .describe("失败时的错误信息")
      .openapi({ example: "connection refused" }),
  })
  .describe("测试 webhook 响应");

export type TestWebhookResponse = z.infer<typeof TestWebhookResponseSchema>;

// ==================== 序列化 ====================

interface NotificationSettingsLike {
  id: number;
  enabled: boolean;
  useLegacyMode: boolean;
  circuitBreakerEnabled: boolean;
  circuitBreakerWebhook: string | null;
  dailyLeaderboardEnabled: boolean;
  dailyLeaderboardWebhook: string | null;
  dailyLeaderboardTime: string | null;
  dailyLeaderboardTopN: number | null;
  costAlertEnabled: boolean;
  costAlertWebhook: string | null;
  costAlertThreshold: string | null;
  costAlertCheckInterval: number | null;
  cacheHitRateAlertEnabled: boolean;
  cacheHitRateAlertWebhook: string | null;
  cacheHitRateAlertWindowMode: "auto" | "5m" | "30m" | "1h" | "1.5h" | null;
  cacheHitRateAlertCheckInterval: number | null;
  cacheHitRateAlertHistoricalLookbackDays: number | null;
  cacheHitRateAlertMinEligibleRequests: number | null;
  cacheHitRateAlertMinEligibleTokens: number | null;
  cacheHitRateAlertAbsMin: string | null;
  cacheHitRateAlertDropRel: string | null;
  cacheHitRateAlertDropAbs: string | null;
  cacheHitRateAlertCooldownMinutes: number | null;
  cacheHitRateAlertTopN: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function serializeNotificationSettings(
  input: NotificationSettingsLike
): NotificationSettingsResponse {
  const created = input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt;
  const updated = input.updatedAt instanceof Date ? input.updatedAt.toISOString() : input.updatedAt;
  return {
    ...input,
    createdAt: created,
    updatedAt: updated,
  };
}
