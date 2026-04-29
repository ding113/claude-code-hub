/**
 * /api/v1 notification-bindings 资源 schema
 *
 * 设计要点：
 * - 通知类型枚举与 actions/notification-bindings.ts 中的 NotificationTypeSchema 保持一致；
 * - 绑定输出复用 webhook-targets 的 redact 形式（脱敏 target）：通过 redactBindingTarget
 *   把内部 WebhookTarget 处理为对外的脱敏视图，避免在 binding 接口里重新泄露 webhook 凭证；
 * - 输入直接对应 BindingInput 数组（PUT 是整体替换）。
 */

import { z } from "@hono/zod-openapi";
import type { WebhookTarget } from "@/repository/webhook-targets";
import { IsoDateTimeSchema } from "../_shared/serialization";
import {
  NotificationTypeSchema as BaseNotificationTypeSchema,
  redactWebhookTarget,
  WebhookTargetResponseSchema,
} from "./webhook-targets";

// ==================== 路径参数 / 枚举 ====================

export const NotificationTypeSchema = BaseNotificationTypeSchema;

export const NotificationTypeParamSchema = z
  .object({
    type: NotificationTypeSchema,
  })
  .describe("通知类型路径参数");

// ==================== 输出：单条绑定 ====================

export const NotificationBindingResponseSchema = z
  .object({
    id: z.number().int().positive().describe("绑定主键").openapi({ example: 1 }),
    notificationType: NotificationTypeSchema,
    targetId: z.number().int().positive().describe("Webhook target ID").openapi({ example: 42 }),
    isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
    scheduleCron: z
      .string()
      .nullable()
      .describe("调度 cron 表达式（仅 daily-leaderboard 等定时类）")
      .openapi({ example: "0 9 * * *" }),
    scheduleTimezone: z
      .string()
      .nullable()
      .describe("调度时区（IANA）")
      .openapi({ example: "Asia/Shanghai" }),
    templateOverride: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("模板覆盖（自定义字段）")
      .openapi({ example: null }),
    createdAt: IsoDateTimeSchema.nullable().describe("创建时间（ISO 字符串）"),
    target: WebhookTargetResponseSchema.describe("关联的 webhook 推送目标（敏感字段已脱敏）"),
  })
  .describe("通知绑定响应（含已脱敏的 target）");

export type NotificationBindingResponse = z.infer<typeof NotificationBindingResponseSchema>;

export const NotificationBindingListResponseSchema = z
  .object({
    items: z.array(NotificationBindingResponseSchema).describe("绑定列表"),
  })
  .describe("通知绑定列表响应");

export type NotificationBindingListResponse = z.infer<typeof NotificationBindingListResponseSchema>;

// ==================== 输入：批量替换绑定 ====================

const BindingInputSchema = z
  .object({
    targetId: z.number().int().positive().describe("Webhook target ID").openapi({ example: 42 }),
    isEnabled: z.boolean().optional().describe("是否启用").openapi({ example: true }),
    scheduleCron: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .describe("调度 cron")
      .openapi({ example: "0 9 * * *" }),
    scheduleTimezone: z
      .string()
      .trim()
      .max(50)
      .nullable()
      .optional()
      .describe("调度时区")
      .openapi({ example: "Asia/Shanghai" }),
    templateOverride: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe("模板覆盖（自定义字段）"),
  })
  .describe("单条绑定输入");

export const NotificationBindingsUpdateSchema = z
  .object({
    bindings: z.array(BindingInputSchema).describe("绑定列表（PUT 整体替换该 type 下的全部绑定）"),
  })
  .describe("更新指定通知类型绑定的请求体");

export type NotificationBindingsUpdateInput = z.infer<typeof NotificationBindingsUpdateSchema>;

// ==================== 序列化 ====================

interface NotificationBindingLike {
  id: number;
  notificationType: "circuit_breaker" | "daily_leaderboard" | "cost_alert" | "cache_hit_rate_alert";
  targetId: number;
  isEnabled: boolean;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  templateOverride: Record<string, unknown> | null;
  createdAt: Date | null;
  target: WebhookTarget;
}

export function serializeNotificationBinding(
  input: NotificationBindingLike
): NotificationBindingResponse {
  return {
    id: input.id,
    notificationType: input.notificationType,
    targetId: input.targetId,
    isEnabled: input.isEnabled,
    scheduleCron: input.scheduleCron,
    scheduleTimezone: input.scheduleTimezone,
    templateOverride: input.templateOverride,
    createdAt: input.createdAt ? input.createdAt.toISOString() : null,
    target: redactWebhookTarget(input.target),
  };
}
