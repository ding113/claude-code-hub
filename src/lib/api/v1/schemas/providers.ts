/**
 * /api/v1 providers 资源 schema
 *
 * 设计要点：
 * - 写操作（create / update）显式使用 ProviderTypeSchema（不含 claude-auth /
 *   gemini-cli），所以隐藏类型会被 zod 自动拒绝；
 * - 读操作输出固定脱敏 key（maskedKey 字段）；POST /providers/{id}/key:reveal 是
 *   issue #1123 的核心：仅在该端点暴露原始 key 字符串；
 * - 写 schema 使用扁平 camelCase（前端友好），handler 在调用 legacy action 时
 *   会转成 snake_case；
 * - 仅校验进入业务逻辑前的最低必要字段（name/url/key/providerType）；
 *   其他可选字段透传给 legacy CreateProviderSchema/UpdateProviderSchema 二次校验。
 */

import { z } from "@hono/zod-openapi";
import type { IsoDateTimeSchema } from "../_shared/serialization";
import { ProviderTypeSchema } from "./_common";

// ==================== 公共 ====================

const ResetModeSchema = z
  .enum(["fixed", "rolling"])
  .describe("限额重置模式")
  .openapi({ example: "rolling" });

// ==================== 输入：创建 provider ====================

/**
 * 创建 provider 的请求体（v1 公共版）。
 *
 * - providerType 用 ProviderTypeSchema（不含 claude-auth/gemini-cli），
 *   因此隐藏类型会被自动拒绝；
 * - 其余字段透传到 legacy CreateProviderSchema 做二次校验，避免维护两份契约。
 */
export const ProviderCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("Provider 显示名")
      .openapi({ example: "Claude Direct" }),
    url: z
      .string()
      .trim()
      .url()
      .max(255)
      .describe("上游 API 基础地址")
      .openapi({ example: "https://api.anthropic.com" }),
    key: z
      .string()
      .min(1)
      .max(1024)
      .describe("Provider API key（仅写入；后续读接口仅返回脱敏值）")
      .openapi({ example: "sk-ant-..." }),
    providerType: ProviderTypeSchema.optional(),
    isEnabled: z.boolean().optional().describe("是否启用"),
    weight: z.number().int().min(1).max(100).optional().describe("调度权重"),
    priority: z.number().int().min(0).optional().describe("调度优先级"),
    costMultiplier: z.number().min(0).optional().describe("成本倍率"),
    groupTag: z.string().max(255).nullable().optional().describe("分组标签（CSV）"),
    websiteUrl: z.string().url().max(512).nullable().optional().describe("供应商官网"),
    proxyUrl: z.string().max(512).nullable().optional().describe("出站代理 URL"),
    proxyFallbackToDirect: z.boolean().optional(),
    customHeaders: z.record(z.string(), z.string()).nullable().optional(),
  })
  .passthrough()
  .describe("创建 provider 的请求体（其余字段会透传到 legacy CreateProviderSchema 做二次校验）")
  .openapi({
    example: {
      name: "Claude Direct",
      url: "https://api.anthropic.com",
      key: "sk-ant-xxxx",
      providerType: "claude",
      isEnabled: true,
      weight: 10,
    },
  });

export type ProviderCreateInput = z.infer<typeof ProviderCreateSchema>;

// ==================== 输入：更新 provider ====================

export const ProviderUpdateSchema = ProviderCreateSchema.partial()
  .describe("更新 provider 的请求体（局部更新；未提供的字段保持原值）")
  .openapi({ example: { weight: 20, isEnabled: false } });

export type ProviderUpdateInput = z.infer<typeof ProviderUpdateSchema>;

// ==================== 输入：批量更新 ====================

export const ProviderBatchUpdateSchema = z
  .object({
    providerIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .describe("待更新的 provider id 列表"),
    updates: z
      .object({
        isEnabled: z.boolean().optional(),
        priority: z.number().int().optional(),
        weight: z.number().int().optional(),
        costMultiplier: z.number().optional(),
        groupTag: z.string().nullable().optional(),
      })
      .passthrough()
      .describe("批量字段更新（其余字段透传 legacy 校验）"),
  })
  .describe("批量更新 provider 的请求体")
  .openapi({
    example: { providerIds: [1, 2, 3], updates: { isEnabled: false } },
  });

export type ProviderBatchUpdateInput = z.infer<typeof ProviderBatchUpdateSchema>;

// ==================== 输入：批量重置熔断 ====================

export const ProviderBatchResetCircuitsSchema = z
  .object({
    providerIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .describe("待重置熔断的 provider id 列表"),
  })
  .describe("批量重置 provider 熔断器请求体")
  .openapi({ example: { providerIds: [1, 2] } });

export type ProviderBatchResetCircuitsInput = z.infer<typeof ProviderBatchResetCircuitsSchema>;

// ==================== 输入：自动排序优先级 ====================

export const ProviderAutoSortPrioritySchema = z
  .object({
    confirm: z.boolean().describe("true 表示真正写库；false 表示仅返回预览"),
  })
  .describe("自动排序 provider 优先级请求体")
  .openapi({ example: { confirm: true } });

export type ProviderAutoSortPriorityInput = z.infer<typeof ProviderAutoSortPrioritySchema>;

// ==================== 输出：provider 详情 ====================

/**
 * Provider 响应（脱敏）。
 *
 * 由于 legacy 字段非常多（80+），这里使用 passthrough 暴露所有字段，
 * 但显式声明关键字段并提供 OpenAPI 元数据。
 */
export const ProviderResponseSchema = z
  .object({
    id: z.number().int().positive().describe("Provider 主键").openapi({ example: 1 }),
    name: z.string().describe("名称").openapi({ example: "Claude Direct" }),
    url: z.string().describe("上游 API 基础地址").openapi({ example: "https://api.anthropic.com" }),
    maskedKey: z
      .string()
      .describe("脱敏后的 key 字符串。原始 key 仅在 GET /providers/{id}/key:reveal 暴露。")
      .openapi({ example: "sk-A•••••B0c1" }),
    isEnabled: z.boolean().describe("是否启用"),
    weight: z.number().int().describe("调度权重"),
    priority: z.number().int().describe("调度优先级"),
    costMultiplier: z
      .union([z.number(), z.string()])
      .describe("成本倍率（旧 schema 可能是字符串）"),
    groupTag: z.string().nullable().describe("分组标签（CSV）"),
    providerType: ProviderTypeSchema.describe("Provider 类型"),
    limit5hUsd: z.number().nullable().optional(),
    limit5hResetMode: ResetModeSchema.optional(),
    limitDailyUsd: z.number().nullable().optional(),
    dailyResetMode: ResetModeSchema.optional(),
    limitWeeklyUsd: z.number().nullable().optional(),
    limitMonthlyUsd: z.number().nullable().optional(),
    limitTotalUsd: z.number().nullable().optional(),
    limitConcurrentSessions: z.number().int().nullable().optional(),
    proxyUrl: z.string().nullable().optional(),
    proxyFallbackToDirect: z.boolean().optional(),
    websiteUrl: z.string().nullable().optional(),
    faviconUrl: z.string().nullable().optional(),
    todayTotalCostUsd: z.union([z.number(), z.string()]).optional(),
    todayCallCount: z.number().int().optional(),
    lastCallTime: z.string().nullable().optional(),
    lastCallModel: z.string().nullable().optional(),
    createdAt: z.string().describe("创建日期（YYYY-MM-DD）"),
    updatedAt: z.string().describe("更新日期（YYYY-MM-DD）"),
  })
  .passthrough()
  .describe("Provider 详情（key 已脱敏）");

export type ProviderResponse = z.infer<typeof ProviderResponseSchema>;

export const ProviderListResponseSchema = z
  .object({
    items: z.array(ProviderResponseSchema).describe("Provider 列表"),
    statistics: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("统计 map（仅当 ?include=statistics 时返回）"),
  })
  .describe("Provider 列表响应");

export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

// ==================== 输出：健康状态 ====================

export const ProviderHealthStatusItemSchema = z
  .object({
    circuitState: z.enum(["closed", "open", "half-open"]),
    failureCount: z.number().int(),
    lastFailureTime: z.number().nullable(),
    circuitOpenUntil: z.number().nullable(),
    recoveryMinutes: z.number().nullable(),
  })
  .describe("单个 provider 的熔断器健康状态");

export const ProviderHealthStatusResponseSchema = z
  .record(z.string(), ProviderHealthStatusItemSchema)
  .describe("熔断器健康状态映射（key 为 providerId）");

// ==================== 输出：分组 ====================

export const ProviderGroupsListSchema = z
  .object({
    items: z
      .array(z.string())
      .describe("分组列表（默认返回全部）")
      .openapi({ example: ["default", "team-a"] }),
  })
  .describe("provider 分组（不含计数）");

export const ProviderGroupsWithCountResponseSchema = z
  .object({
    items: z
      .array(
        z.object({
          group: z.string().describe("分组名"),
          providerCount: z.number().int().nonnegative().describe("该分组下的 provider 数量"),
        })
      )
      .describe("分组列表 + 计数"),
  })
  .describe("provider 分组（含计数）");

// ==================== 输出：key:reveal ====================

/**
 * Issue #1123 的核心契约：暴露完整 provider key。
 *
 * - 仅 admin 可调用；
 * - 响应必须带 Cache-Control: no-store；
 * - legacy action 已经记录审计日志（不含 key 内容）。
 */
export const ProviderKeyRevealResponseSchema = z
  .object({
    id: z.number().int().positive().describe("Provider 主键").openapi({ example: 1 }),
    key: z
      .string()
      .describe("**完整原始 API key**。响应会带 Cache-Control: no-store；调用方需立即脱敏存储。")
      .openapi({ example: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx" }),
  })
  .describe("Issue #1123 的明文 key 响应（仅 admin 可调用，响应不可缓存）");

export type ProviderKeyRevealResponse = z.infer<typeof ProviderKeyRevealResponseSchema>;

// ==================== 输出：通用 ok ====================

export const ProviderOkResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .describe("通用幂等 ok 响应");

// ==================== 序列化 ====================

const REDACT_PLACEHOLDER = "••••••";

/** 把原始 key 字符串脱敏：保留头 4 字符 / 尾 4 字符，其余替换为圆点 */
export function maskProviderKey(rawKey: string | null | undefined): string {
  if (!rawKey) return REDACT_PLACEHOLDER;
  if (rawKey.length <= 8) return REDACT_PLACEHOLDER;
  return `${rawKey.slice(0, 4)}${REDACT_PLACEHOLDER}${rawKey.slice(-4)}`;
}

/**
 * 把 ProviderDisplay -> ProviderResponse；保留 maskedKey 字段；
 * **总是剥离原始 `key` 字段**，避免在列表 / 详情中泄露明文。
 * 其他字段原样透传（含 createdAt / updatedAt 字符串）。
 */
export function serializeProvider(provider: Record<string, unknown>): ProviderResponse {
  const p = provider as Record<string, unknown> & {
    id: number;
    name: string;
    url: string;
    maskedKey?: string;
    key?: string;
    providerType: string;
  };
  // 拷贝并剥离 key（原始 key 字符串），避免在列表 / 详情接口中泄露。
  const { key: _key, ...rest } = p;
  return {
    ...(rest as Record<string, unknown>),
    maskedKey:
      typeof p.maskedKey === "string"
        ? p.maskedKey
        : maskProviderKey(typeof _key === "string" ? _key : null),
  } as ProviderResponse;
}

// ==================== 隐藏 provider 类型过滤 ====================

const VISIBLE_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "gemini",
  "openai-compatible",
]);

/** 过滤掉 providerType 为 claude-auth / gemini-cli 的记录（v1 不暴露） */
export function filterVisibleProviders<T extends { providerType?: string }>(records: T[]): T[] {
  return records.filter((r) => {
    if (typeof r.providerType !== "string") return true;
    return VISIBLE_PROVIDER_TYPES.has(r.providerType);
  });
}

export type IsoDateTimeSchemaForReexport = typeof IsoDateTimeSchema;
