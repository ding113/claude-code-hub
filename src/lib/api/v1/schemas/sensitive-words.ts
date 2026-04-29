/**
 * /api/v1 sensitive-words 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const SensitiveWordMatchTypeSchema = z
  .enum(["contains", "exact", "regex"])
  .describe("匹配类型");

export const SensitiveWordSchema = z
  .object({
    id: z.number().int(),
    word: z.string(),
    matchType: SensitiveWordMatchTypeSchema,
    description: z.string().nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .passthrough()
  .describe("敏感词（passthrough）")
  .openapi({ example: { id: 1, word: "secret", matchType: "contains", isEnabled: true } });

export const SensitiveWordsListResponseSchema = z
  .object({
    items: z.array(SensitiveWordSchema),
  })
  .describe("敏感词列表");

export const SensitiveWordCreateSchema = z
  .object({
    word: z.string().min(1),
    matchType: SensitiveWordMatchTypeSchema,
    description: z.string().optional(),
  })
  .describe("创建敏感词请求体")
  .openapi({ example: { word: "secret", matchType: "contains" } });

export const SensitiveWordUpdateSchema = z
  .object({
    word: z.string().optional(),
    matchType: SensitiveWordMatchTypeSchema.optional(),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
  })
  .describe("更新敏感词请求体");

export const SensitiveWordsCacheRefreshResponseSchema = z
  .object({})
  .passthrough()
  .describe("缓存刷新结果（passthrough）");

export const SensitiveWordsCacheStatsResponseSchema = z
  .object({})
  .passthrough()
  .nullable()
  .describe("缓存统计（passthrough）");
