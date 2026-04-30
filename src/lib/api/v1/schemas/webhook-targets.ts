/**
 * /api/v1 webhook-targets 资源 schema
 *
 * 设计要点：
 * - 输入 schema（create / update / test）允许携带敏感字段（webhookUrl /
 *   telegramBotToken / telegramChatId / dingtalkSecret），写入数据库；
 * - 输出 schema 永远脱敏：相应字段在响应中固定为字符串 "[REDACTED]" 或
 *   原始 null（用于区分「未配置」与「已配置但隐藏」）；
 * - `redactWebhookTarget(target)` 是唯一的脱敏出口，handler 在序列化响应时
 *   必须调用它，禁止手写脱敏逻辑；
 * - customTemplate / customHeaders 不属于「单点凭证」类敏感字段，按业务需要
 *   原样回传（用户在 UI 上需要看到模板内容才能调整）。
 */

import { z } from "@hono/zod-openapi";
import type { WebhookTarget } from "@/repository/webhook-targets";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 枚举 ====================

/** Webhook 提供方类型 */
export const WebhookProviderTypeSchema = z
  .enum(["wechat", "feishu", "dingtalk", "telegram", "custom"])
  .describe("Webhook 推送目标提供方类型")
  .openapi({ example: "wechat" });

export type WebhookProviderType = z.infer<typeof WebhookProviderTypeSchema>;

/** 通知类别（与 toJobType 中的映射对齐） */
export const NotificationTypeSchema = z
  .enum(["circuit_breaker", "daily_leaderboard", "cost_alert", "cache_hit_rate_alert"])
  .describe("通知类别（用于 :test 端点选择测试模板）")
  .openapi({ example: "circuit_breaker" });

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

// ==================== 自定义模板（输入兼容字符串与对象） ====================

const CustomTemplateInputSchema = z
  .union([z.string().trim(), z.record(z.string(), z.unknown())])
  .describe("自定义模板：JSON 对象或可被解析为对象的字符串")
  .openapi({ example: { title: "{{event}}", body: "{{message}}" } });

const CustomHeadersInputSchema = z
  .record(z.string(), z.string())
  .describe("自定义 HTTP 头键值对（仅 custom 类型使用）")
  .openapi({ example: { "X-Source": "claude-code-hub" } });

// ==================== 输入：创建 ====================

export const WebhookTargetCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "目标名称不能为空")
      .max(100, "目标名称不能超过100个字符")
      .describe("目标名称（用户可见的显示名）")
      .openapi({ example: "运维群-企业微信" }),
    providerType: WebhookProviderTypeSchema,
    webhookUrl: z
      .string()
      .trim()
      .url("Webhook URL 格式不正确")
      .nullable()
      .optional()
      .describe("Webhook URL（telegram 类型不使用此字段）")
      .openapi({ example: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." }),
    telegramBotToken: z
      .string()
      .trim()
      .min(1, "Telegram Bot Token 不能为空")
      .nullable()
      .optional()
      .describe("Telegram Bot Token（仅 telegram 类型）")
      .openapi({ example: "123456:AAEXXXXXX" }),
    telegramChatId: z
      .string()
      .trim()
      .min(1, "Telegram Chat ID 不能为空")
      .nullable()
      .optional()
      .describe("Telegram Chat ID（仅 telegram 类型）")
      .openapi({ example: "-1001234567890" }),
    dingtalkSecret: z
      .string()
      .trim()
      .nullable()
      .optional()
      .describe("钉钉机器人加签密钥（仅 dingtalk 类型）")
      .openapi({ example: "SEC1234567890" }),
    customTemplate: CustomTemplateInputSchema.nullable().optional(),
    customHeaders: CustomHeadersInputSchema.nullable().optional(),
    proxyUrl: z
      .string()
      .trim()
      .nullable()
      .optional()
      .describe("出站代理地址（http / https / socks5 / socks4）")
      .openapi({ example: "http://proxy.example:1080" }),
    proxyFallbackToDirect: z
      .boolean()
      .optional()
      .describe("代理失败时是否回退到直连")
      .openapi({ example: false }),
    isEnabled: z.boolean().optional().describe("是否启用该目标").openapi({ example: true }),
  })
  .describe("创建 webhook 推送目标的请求体")
  .openapi({
    example: {
      name: "运维群-企业微信",
      providerType: "wechat",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
      isEnabled: true,
    },
  });

export type WebhookTargetCreateInput = z.infer<typeof WebhookTargetCreateSchema>;

// ==================== 输入：更新 ====================

export const WebhookTargetUpdateSchema = WebhookTargetCreateSchema.partial()
  .describe("更新 webhook 推送目标的请求体（局部更新）")
  .openapi({ example: { isEnabled: false } });

export type WebhookTargetUpdateInput = z.infer<typeof WebhookTargetUpdateSchema>;

// ==================== 输入：测试 ====================

export const WebhookTargetTestSchema = z
  .object({
    notificationType: NotificationTypeSchema,
  })
  .describe("测试 webhook 推送目标的请求体")
  .openapi({ example: { notificationType: "circuit_breaker" } });

export type WebhookTargetTestInput = z.infer<typeof WebhookTargetTestSchema>;

// ==================== 输出：脱敏的响应 ====================

const REDACTED = "[REDACTED]" as const;

const RedactedSecretSchema = z
  .union([z.literal(REDACTED), z.null()])
  .describe('已脱敏的敏感字段：未配置时为 null；已配置时固定为字符串 "[REDACTED]"')
  .openapi({ example: REDACTED });

export const WebhookTargetResponseSchema = z
  .object({
    id: z.number().int().positive().describe("数据库主键").openapi({ example: 1 }),
    name: z.string().describe("目标名称").openapi({ example: "运维群-企业微信" }),
    providerType: WebhookProviderTypeSchema,
    webhookUrl: RedactedSecretSchema,
    telegramBotToken: RedactedSecretSchema,
    telegramChatId: RedactedSecretSchema,
    dingtalkSecret: RedactedSecretSchema,
    customTemplate: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("自定义模板（不属于敏感凭证，原样回传）")
      .openapi({ example: { title: "{{event}}" } }),
    customHeaders: z
      .record(z.string(), z.string())
      .nullable()
      .describe("自定义 HTTP 头")
      .openapi({ example: { "X-Source": "claude-code-hub" } }),
    proxyUrl: z
      .string()
      .nullable()
      .describe("出站代理地址；如未配置则为 null")
      .openapi({ example: null }),
    proxyFallbackToDirect: z
      .boolean()
      .describe("代理失败时是否回退到直连")
      .openapi({ example: false }),
    isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
    lastTestSuccess: z
      .boolean()
      .nullable()
      .describe("上次测试是否成功；未测试过为 null")
      .openapi({ example: true }),
    lastTestError: z
      .string()
      .nullable()
      .describe("上次测试的错误描述（失败时存在）")
      .openapi({ example: null }),
    lastTestAt: IsoDateTimeSchema.nullable().describe("上次测试时间（ISO 8601）"),
    lastTestLatencyMs: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("上次测试的延迟（毫秒）")
      .openapi({ example: 234 }),
    createdAt: IsoDateTimeSchema.nullable().describe("创建时间（ISO 8601）"),
    updatedAt: IsoDateTimeSchema.nullable().describe("更新时间（ISO 8601）"),
  })
  .describe("Webhook 推送目标响应（敏感字段已脱敏）");

export type WebhookTargetResponse = z.infer<typeof WebhookTargetResponseSchema>;

export const WebhookTargetListResponseSchema = z
  .object({
    items: z.array(WebhookTargetResponseSchema).describe("Webhook 推送目标列表"),
  })
  .describe("Webhook 推送目标列表响应");

export type WebhookTargetListResponse = z.infer<typeof WebhookTargetListResponseSchema>;

export const WebhookTargetTestResponseSchema = z
  .object({
    latencyMs: z
      .number()
      .int()
      .nonnegative()
      .describe("本次测试发送耗时（毫秒）")
      .openapi({ example: 234 }),
  })
  .describe("Webhook 推送目标测试响应");

export type WebhookTargetTestResponse = z.infer<typeof WebhookTargetTestResponseSchema>;

// ==================== 脱敏函数 ====================

/**
 * 把仓储 / action 返回的 WebhookTarget 序列化为响应模型。
 *
 * 行为：
 * - 把 webhookUrl / telegramBotToken / telegramChatId / dingtalkSecret 一律
 *   替换为 `"[REDACTED]"`（已配置）或 `null`（未配置）；
 * - 把 lastTestResult 拆分为 lastTestSuccess / lastTestError / lastTestLatencyMs；
 * - Date 字段统一序列化为 ISO 字符串（带时区偏移）。
 */
export function redactWebhookTarget(target: WebhookTarget): WebhookTargetResponse {
  const lastTest = target.lastTestResult ?? null;
  return {
    id: target.id,
    name: target.name,
    providerType: target.providerType,
    webhookUrl: target.webhookUrl ? REDACTED : null,
    telegramBotToken: target.telegramBotToken ? REDACTED : null,
    telegramChatId: target.telegramChatId ? REDACTED : null,
    dingtalkSecret: target.dingtalkSecret ? REDACTED : null,
    customTemplate: target.customTemplate,
    customHeaders: target.customHeaders,
    proxyUrl: target.proxyUrl,
    proxyFallbackToDirect: target.proxyFallbackToDirect,
    isEnabled: target.isEnabled,
    lastTestSuccess: lastTest ? lastTest.success : null,
    lastTestError: lastTest?.error ?? null,
    lastTestAt: target.lastTestAt ? target.lastTestAt.toISOString() : null,
    lastTestLatencyMs: lastTest?.latencyMs ?? null,
    createdAt: target.createdAt ? target.createdAt.toISOString() : null,
    updatedAt: target.updatedAt ? target.updatedAt.toISOString() : null,
  };
}
