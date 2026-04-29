/**
 * /api/v1 admin-user-insights 资源 schema
 *
 * 设计要点：
 * - 4 个端点对应 4 个 action：overview / key-trend / model-breakdown / provider-breakdown；
 * - overview / breakdown 三个端点接收同一组 query：startDate, endDate (YYYY-MM-DD)，
 *   外加可选 filters（keyId, providerId, model）；
 * - key-trend 接收 timeRange = today | 7days | 30days | thisMonth；
 * - 响应中的 user / overview / breakdown / currencyCode 直接照映 action 返回结构。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== Query schemas ====================

const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "格式必须为 YYYY-MM-DD")
  .describe("日期字符串 YYYY-MM-DD");

export const InsightsDateRangeQuerySchema = z
  .object({
    startDate: DateStringSchema.optional().describe("起始日期").openapi({ example: "2026-04-01" }),
    endDate: DateStringSchema.optional().describe("结束日期").openapi({ example: "2026-04-28" }),
  })
  .describe("日期范围查询参数");

export type InsightsDateRangeQuery = z.infer<typeof InsightsDateRangeQuerySchema>;

export const InsightsKeyTrendQuerySchema = z
  .object({
    timeRange: z
      .enum(["today", "7days", "30days", "thisMonth"])
      .describe("时间范围预设")
      .openapi({ example: "7days" }),
  })
  .describe("Key 趋势统计的时间范围参数");

export type InsightsKeyTrendQuery = z.infer<typeof InsightsKeyTrendQuerySchema>;

export const InsightsModelBreakdownQuerySchema = InsightsDateRangeQuerySchema.extend({
  keyId: z.coerce.number().int().positive().optional().describe("仅看指定 key 的数据"),
  providerId: z.coerce.number().int().positive().optional().describe("仅看指定 provider 的数据"),
}).describe("Model 维度统计查询参数");

export type InsightsModelBreakdownQuery = z.infer<typeof InsightsModelBreakdownQuerySchema>;

export const InsightsProviderBreakdownQuerySchema = InsightsDateRangeQuerySchema.extend({
  keyId: z.coerce.number().int().positive().optional().describe("仅看指定 key 的数据"),
  model: z.string().optional().describe("仅看指定 model 的数据"),
}).describe("Provider 维度统计查询参数");

export type InsightsProviderBreakdownQuery = z.infer<typeof InsightsProviderBreakdownQuerySchema>;

// ==================== Response schemas ====================

const InsightsUserSchema = z
  .object({
    id: z.number().int().positive().describe("用户 ID").openapi({ example: 1 }),
    name: z.string().describe("用户名").openapi({ example: "alice" }),
    description: z.string().describe("用户描述").openapi({ example: "" }),
    role: z.enum(["admin", "user"]).describe("角色").openapi({ example: "user" }),
    isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
    expiresAt: IsoDateTimeSchema.nullable().describe("过期时间"),
    createdAt: IsoDateTimeSchema.describe("创建时间"),
    updatedAt: IsoDateTimeSchema.describe("更新时间"),
  })
  .describe("用户信息（用于 insights overview 头部展示）");

const InsightsOverviewMetricsSchema = z
  .object({
    requestCount: z.number().int().nonnegative().describe("请求总数").openapi({ example: 1234 }),
    totalCost: z.number().describe("总花费（USD）").openapi({ example: 12.34 }),
    avgResponseTime: z.number().describe("平均响应时间（ms）").openapi({ example: 850 }),
    errorRate: z.number().describe("错误率（0-1）").openapi({ example: 0.01 }),
  })
  .describe("用户洞察核心指标");

export const InsightsOverviewResponseSchema = z
  .object({
    user: InsightsUserSchema,
    overview: InsightsOverviewMetricsSchema,
    currencyCode: z.string().describe("货币代码").openapi({ example: "USD" }),
  })
  .describe("用户洞察 - overview 响应");

export type InsightsOverviewResponse = z.infer<typeof InsightsOverviewResponseSchema>;

const KeyTrendItemSchema = z
  .object({
    key_id: z.number().int().describe("Key 主键").openapi({ example: 100 }),
    key_name: z.string().describe("Key 名称").openapi({ example: "default" }),
    date: z.string().describe("日期或时间戳").openapi({ example: "2026-04-01" }),
    api_calls: z.number().int().nonnegative().describe("调用次数").openapi({ example: 12 }),
    total_cost: z
      .union([z.string(), z.number(), z.null()])
      .describe("总花费（DB 原始值）")
      .openapi({ example: "1.23" }),
  })
  .describe("Key 趋势统计单行");

export const InsightsKeyTrendResponseSchema = z
  .object({
    items: z.array(KeyTrendItemSchema).describe("Key 趋势数据"),
  })
  .describe("用户洞察 - key trend 响应");

export type InsightsKeyTrendResponse = z.infer<typeof InsightsKeyTrendResponseSchema>;

const ModelBreakdownItemSchema = z
  .object({
    model: z.string().nullable().describe("模型名").openapi({ example: "claude-sonnet-4" }),
    requests: z.number().int().nonnegative().describe("请求数").openapi({ example: 100 }),
    cost: z.number().describe("总花费").openapi({ example: 1.23 }),
    inputTokens: z.number().int().nonnegative().describe("输入 token").openapi({ example: 5000 }),
    outputTokens: z.number().int().nonnegative().describe("输出 token").openapi({ example: 2000 }),
    cacheCreationTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("cache 写入 token")
      .openapi({ example: 0 }),
    cacheReadTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("cache 读取 token")
      .openapi({ example: 0 }),
  })
  .describe("模型维度统计单行");

export const InsightsModelBreakdownResponseSchema = z
  .object({
    breakdown: z.array(ModelBreakdownItemSchema).describe("按模型聚合的数据"),
    currencyCode: z.string().describe("货币代码").openapi({ example: "USD" }),
  })
  .describe("用户洞察 - model breakdown 响应");

export type InsightsModelBreakdownResponse = z.infer<typeof InsightsModelBreakdownResponseSchema>;

const ProviderBreakdownItemSchema = z
  .object({
    providerId: z.number().int().describe("Provider 主键").openapi({ example: 1 }),
    providerName: z.string().nullable().describe("Provider 名").openapi({ example: "anthropic" }),
    requests: z.number().int().nonnegative().describe("请求数").openapi({ example: 50 }),
    cost: z.number().describe("总花费").openapi({ example: 0.5 }),
    inputTokens: z.number().int().nonnegative().describe("输入 token").openapi({ example: 1000 }),
    outputTokens: z.number().int().nonnegative().describe("输出 token").openapi({ example: 500 }),
    cacheCreationTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("cache 写入 token")
      .openapi({ example: 0 }),
    cacheReadTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("cache 读取 token")
      .openapi({ example: 0 }),
  })
  .describe("Provider 维度统计单行");

export const InsightsProviderBreakdownResponseSchema = z
  .object({
    breakdown: z.array(ProviderBreakdownItemSchema).describe("按 provider 聚合的数据"),
    currencyCode: z.string().describe("货币代码").openapi({ example: "USD" }),
  })
  .describe("用户洞察 - provider breakdown 响应");

export type InsightsProviderBreakdownResponse = z.infer<
  typeof InsightsProviderBreakdownResponseSchema
>;

// ==================== 序列化辅助 ====================

/** 把 User entity 序列化成 InsightsUserSchema；Date -> ISO 字符串。 */
export function serializeInsightsUser(input: Record<string, unknown>): {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  isEnabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  const u = input as {
    id: number;
    name: string;
    description: string;
    role: "admin" | "user";
    isEnabled: boolean;
    expiresAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  return {
    id: u.id,
    name: u.name,
    description: u.description ?? "",
    role: u.role,
    isEnabled: u.isEnabled,
    expiresAt: u.expiresAt instanceof Date ? u.expiresAt.toISOString() : null,
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
    updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : String(u.updatedAt),
  };
}
