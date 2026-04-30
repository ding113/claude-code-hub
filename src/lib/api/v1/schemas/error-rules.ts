/**
 * /api/v1 error-rules 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const ErrorRuleCategorySchema = z
  .enum([
    "prompt_limit",
    "content_filter",
    "pdf_limit",
    "thinking_error",
    "parameter_error",
    "invalid_request",
    "cache_limit",
  ])
  .describe("错误规则类别");

export const ErrorRuleMatchTypeSchema = z.enum(["contains", "exact", "regex"]).describe("匹配类型");

export const ErrorRuleSchema = z
  .object({
    id: z.number().int(),
    pattern: z.string(),
    category: ErrorRuleCategorySchema,
    matchType: ErrorRuleMatchTypeSchema,
    description: z.string().nullable().optional(),
    overrideResponse: z.unknown().nullable().optional(),
    overrideStatusCode: z.number().int().nullable().optional(),
    isEnabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .passthrough()
  .describe("错误规则（passthrough）")
  .openapi({
    example: {
      id: 1,
      pattern: "rate limit",
      category: "prompt_limit",
      matchType: "contains",
      isEnabled: true,
      priority: 10,
    },
  });

export const ErrorRulesListResponseSchema = z
  .object({
    items: z.array(ErrorRuleSchema),
  })
  .describe("错误规则列表");

export const ErrorRuleCreateSchema = z
  .object({
    pattern: z.string().min(1),
    category: ErrorRuleCategorySchema,
    matchType: ErrorRuleMatchTypeSchema.optional(),
    description: z.string().optional(),
    overrideResponse: z.unknown().nullable().optional(),
    overrideStatusCode: z.number().int().min(400).max(599).nullable().optional(),
  })
  .describe("创建错误规则的请求体")
  .openapi({
    example: { pattern: "rate limit", category: "prompt_limit", matchType: "contains" },
  });

export const ErrorRuleUpdateSchema = z
  .object({
    pattern: z.string().optional(),
    category: ErrorRuleCategorySchema.optional(),
    matchType: ErrorRuleMatchTypeSchema.optional(),
    description: z.string().optional(),
    overrideResponse: z.unknown().nullable().optional(),
    overrideStatusCode: z.number().int().nullable().optional(),
    isEnabled: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .describe("更新错误规则的请求体（局部更新）");

export const ErrorRuleTestRequestSchema = z
  .object({
    message: z.string().min(1).describe("用于测试的错误消息"),
  })
  .describe("测试错误规则匹配")
  .openapi({ example: { message: "rate limit exceeded" } });

export const ErrorRuleTestResponseSchema = z
  .object({})
  .passthrough()
  .describe("错误规则测试结果（passthrough）");

export const ErrorRulesCacheRefreshResponseSchema = z
  .object({})
  .passthrough()
  .describe("缓存刷新结果（passthrough）");

export const ErrorRulesCacheStatsResponseSchema = z
  .object({})
  .passthrough()
  .nullable()
  .describe("缓存统计（passthrough；未授权时为 null）");
