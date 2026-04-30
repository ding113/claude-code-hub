/**
 * /api/v1 keys 资源 schema
 *
 * 设计要点：
 * - 输入 schema 复用 `KeyFormSchema` (src/lib/validation/schemas.ts)；
 * - 输出 schema 永远脱敏 `key` 字符串（通过 redactKey），
 *   ONLY EXCEPTION: POST /users/{userId}/keys 的 201 响应里返回完整原始 key 字符串
 *   一次（与 legacy addKey 行为对齐），并在 OpenAPI 描述中明确标注。
 */

import { z } from "@hono/zod-openapi";
import { KeyFormSchema } from "@/lib/validation/schemas";
import { IsoDateTimeSchema } from "../_shared/serialization";
import { redactKey } from "./users";

// ==================== 输入：创建 key ====================

export const KeyCreateSchema = KeyFormSchema.extend({
  isEnabled: z.boolean().optional().describe("是否启用此 key").openapi({ example: true }),
})
  .describe("创建 key 的请求体（包含限额与启用状态）")
  .openapi({
    example: {
      name: "default",
      canLoginWebUi: true,
      isEnabled: true,
      limit5hResetMode: "rolling",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      providerGroup: "default",
      cacheTtlPreference: "inherit",
      limitConcurrentSessions: 0,
    },
  });

export type KeyCreateInput = z.infer<typeof KeyCreateSchema>;

// ==================== 输入：更新 key ====================

export const KeyUpdateSchema = KeyFormSchema.extend({
  isEnabled: z.boolean().optional().describe("是否启用此 key").openapi({ example: true }),
})
  .partial()
  .describe("更新 key 的请求体（局部更新）")
  .openapi({
    example: { name: "renamed", isEnabled: false },
  });

export type KeyUpdateInput = z.infer<typeof KeyUpdateSchema>;

// ==================== 输入：动作动词 ====================

export const KeyEnableSchema = z
  .object({
    enabled: z.boolean().describe("目标启用状态").openapi({ example: false }),
  })
  .describe("切换 key 启用状态的请求体");

export type KeyEnableInput = z.infer<typeof KeyEnableSchema>;

export const KeyRenewSchema = z
  .object({
    expiresAt: z
      .string()
      .min(1)
      .describe("新的过期时间（ISO 8601 字符串）")
      .openapi({ example: "2026-12-31T23:59:59Z" }),
    enableKey: z.boolean().optional().describe("是否同时启用 key").openapi({ example: true }),
  })
  .describe("续期 key 的请求体");

export type KeyRenewInput = z.infer<typeof KeyRenewSchema>;

// ==================== 输出：key 详情 ====================

const ResetModeSchema = z
  .enum(["fixed", "rolling"])
  .describe("限额重置模式")
  .openapi({ example: "rolling" });

const KeyResponseBase = z.object({
  id: z.number().int().positive().describe("Key 主键").openapi({ example: 100 }),
  userId: z.number().int().positive().describe("所属用户 ID").openapi({ example: 1 }),
  name: z.string().describe("Key 名称").openapi({ example: "default" }),
  isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
  canLoginWebUi: z.boolean().describe("是否允许使用此 key 登录 Web UI").openapi({ example: true }),
  providerGroup: z
    .string()
    .nullable()
    .describe("供应商分组覆盖；null 表示沿用用户分组")
    .openapi({ example: "default" }),
  expiresAt: IsoDateTimeSchema.nullable().describe("过期时间（ISO 字符串）；null = 永不过期"),
  limit5hUsd: z.number().nullable().describe("5 小时消费上限").openapi({ example: null }),
  limit5hResetMode: ResetModeSchema,
  limitDailyUsd: z.number().nullable().describe("每日消费上限").openapi({ example: 10 }),
  dailyResetMode: ResetModeSchema,
  dailyResetTime: z.string().describe("每日重置时间 (HH:mm)").openapi({ example: "00:00" }),
  limitWeeklyUsd: z.number().nullable().describe("周消费上限").openapi({ example: null }),
  limitMonthlyUsd: z.number().nullable().describe("月消费上限").openapi({ example: null }),
  limitTotalUsd: z.number().nullable().describe("总消费上限").openapi({ example: null }),
  limitConcurrentSessions: z
    .number()
    .int()
    .nonnegative()
    .describe("并发会话上限；0 表示不限制")
    .openapi({ example: 0 }),
  cacheTtlPreference: z
    .enum(["inherit", "5m", "1h"])
    .nullable()
    .describe("缓存 TTL 偏好")
    .openapi({ example: "inherit" }),
  costResetAt: IsoDateTimeSchema.nullable().describe("软重置时间（ISO 字符串）"),
  createdAt: IsoDateTimeSchema.nullable().describe("创建时间（ISO 字符串）"),
  updatedAt: IsoDateTimeSchema.nullable().describe("更新时间（ISO 字符串）"),
});

/** Key 响应（普通 GET / PATCH 等读返回；key 字符串永远脱敏） */
export const KeyResponseSchema = KeyResponseBase.extend({
  key: z
    .string()
    .describe("脱敏后的 key 字符串（原始 key 仅在创建时返回一次）")
    .openapi({ example: "sk-A•••••B0c1" }),
}).describe("Key 响应（key 字符串已脱敏）");

export type KeyResponse = z.infer<typeof KeyResponseSchema>;

/**
 * Key 创建响应：包含原始 key 字符串。**仅 POST /users/{userId}/keys 使用**。
 * 文档中明确说明这是 ONE-TIME exposure，前端读到后需立即让用户复制保存。
 */
export const KeyCreatedResponseSchema = z
  .object({
    id: z.number().int().positive().describe("新 key 主键").openapi({ example: 100 }),
    name: z.string().describe("Key 名称").openapi({ example: "default" }),
    key: z
      .string()
      .describe(
        "新创建的原始 API key 字符串。**仅在创建响应中返回一次**；后续读接口仅回传脱敏字符串。"
      )
      .openapi({ example: "sk-abcdef0123456789abcdef0123456789" }),
  })
  .describe("Key 创建响应；原始 key 字符串只在此响应里出现一次");

export type KeyCreatedResponse = z.infer<typeof KeyCreatedResponseSchema>;

// ==================== 输出：列表 ====================

export const KeyListResponseSchema = z
  .object({
    items: z.array(KeyResponseSchema).describe("Key 列表（已脱敏）"),
  })
  .describe("Key 列表响应");

export type KeyListResponse = z.infer<typeof KeyListResponseSchema>;

// ==================== 输出：limit-usage ====================

const LimitUsageItemSchema = z
  .object({
    current: z.number().describe("当前已使用值").openapi({ example: 1.23 }),
    limit: z.number().nullable().describe("上限；null 表示不限制").openapi({ example: 10 }),
    resetAt: IsoDateTimeSchema.optional().describe("下次重置时间（ISO 字符串）"),
  })
  .describe("单项限额使用情况");

const ConcurrentSessionsUsageSchema = z
  .object({
    current: z.number().int().nonnegative().describe("当前并发会话数").openapi({ example: 0 }),
    limit: z.number().int().describe("并发会话上限").openapi({ example: 0 }),
  })
  .describe("并发会话限额使用情况");

export const KeyLimitUsageResponseSchema = z
  .object({
    cost5h: LimitUsageItemSchema.describe("5 小时消费"),
    costDaily: LimitUsageItemSchema.describe("每日消费"),
    costWeekly: LimitUsageItemSchema.describe("每周消费"),
    costMonthly: LimitUsageItemSchema.describe("每月消费"),
    costTotal: LimitUsageItemSchema.describe("总消费"),
    concurrentSessions: ConcurrentSessionsUsageSchema,
  })
  .describe("Key 实时限额使用情况");

export type KeyLimitUsageResponse = z.infer<typeof KeyLimitUsageResponseSchema>;

// ==================== 输出：quota-usage（兼容 legacy getKeyQuotaUsage 形状） ====================

const KeyQuotaItemSchema = z
  .object({
    type: z
      .enum(["limit5h", "limitDaily", "limitWeekly", "limitMonthly", "limitTotal", "limitSessions"])
      .describe("配额项类型"),
    current: z.number().describe("当前已使用值"),
    limit: z.number().nullable().describe("上限；null 表示不限制"),
    mode: z.enum(["fixed", "rolling"]).optional().describe("窗口模式（仅 5h / daily 等返回）"),
    time: z.string().optional().describe("HH:mm 重置时间（仅 daily 返回）"),
    resetAt: IsoDateTimeSchema.optional().describe("软重置时间（仅 limitTotal 返回）"),
  })
  .describe("单个 quota 项");

export const KeyQuotaUsageResponseSchema = z
  .object({
    keyName: z.string().describe("Key 名称").openapi({ example: "default" }),
    items: z.array(KeyQuotaItemSchema).describe("quota 项列表（顺序固定）"),
    currencyCode: z.string().describe("用于格式化的货币代码").openapi({ example: "USD" }),
  })
  .describe("Key 实时 quota 使用情况（保持与 legacy getKeyQuotaUsage 相同形状）");

export type KeyQuotaUsageResponse = z.infer<typeof KeyQuotaUsageResponseSchema>;

// ==================== 序列化：脱敏 ====================

/**
 * 把 repository / Drizzle 返回的 Key row 序列化为 KeyResponse；key 字符串脱敏。
 */
export function serializeKey(key: Record<string, unknown>): KeyResponse {
  const k = key as Record<string, unknown> & {
    id: number;
    userId: number;
    name: string;
    key: string;
    isEnabled: boolean;
    canLoginWebUi: boolean;
    providerGroup: string | null;
    expiresAt?: Date | string | null;
    limit5hUsd: number | null;
    limit5hResetMode: "fixed" | "rolling";
    limitDailyUsd: number | null;
    dailyResetMode: "fixed" | "rolling";
    dailyResetTime: string;
    limitWeeklyUsd: number | null;
    limitMonthlyUsd: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions: number;
    cacheTtlPreference: "inherit" | "5m" | "1h" | null;
    costResetAt?: Date | string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
  };
  const toIso = (v: Date | string | null | undefined): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    return typeof v === "string" ? v : null;
  };
  return {
    id: k.id,
    userId: k.userId,
    name: k.name,
    key: redactKey(k.key),
    isEnabled: k.isEnabled,
    canLoginWebUi: k.canLoginWebUi,
    providerGroup: k.providerGroup,
    expiresAt: toIso(k.expiresAt),
    limit5hUsd: k.limit5hUsd ?? null,
    limit5hResetMode: k.limit5hResetMode,
    limitDailyUsd: k.limitDailyUsd ?? null,
    dailyResetMode: k.dailyResetMode,
    dailyResetTime: k.dailyResetTime,
    limitWeeklyUsd: k.limitWeeklyUsd ?? null,
    limitMonthlyUsd: k.limitMonthlyUsd ?? null,
    limitTotalUsd: k.limitTotalUsd ?? null,
    limitConcurrentSessions: k.limitConcurrentSessions ?? 0,
    cacheTtlPreference: k.cacheTtlPreference ?? null,
    costResetAt: toIso(k.costResetAt),
    createdAt: toIso(k.createdAt),
    updatedAt: toIso(k.updatedAt),
  };
}
