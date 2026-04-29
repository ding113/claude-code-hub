/**
 * /api/v1 request-filters 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const RequestFilterSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    scope: z.string().optional(),
    action: z.string().optional(),
    target: z.string().optional(),
    isEnabled: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .passthrough()
  .describe("Request filter（passthrough）")
  .openapi({ example: { id: 1, name: "block-foo", scope: "request", action: "deny" } });

export const RequestFiltersListResponseSchema = z
  .object({
    items: z.array(RequestFilterSchema),
  })
  .describe("Request filters 列表");

export const RequestFilterCreateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    scope: z.string(),
    action: z.string(),
    target: z.string(),
    matchType: z.string().nullable().optional(),
    replacement: z.unknown().optional(),
    priority: z.number().int().optional(),
    bindingType: z.string().optional(),
    providerIds: z.array(z.number().int()).nullable().optional(),
    groupTags: z.array(z.string()).nullable().optional(),
    ruleMode: z.string().optional(),
    executionPhase: z.string().optional(),
    operations: z.array(z.unknown()).nullable().optional(),
  })
  .describe("创建 request filter 请求体")
  .openapi({
    example: {
      name: "block-foo",
      scope: "request",
      action: "deny",
      target: "foo",
    },
  });

export const RequestFilterUpdateSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    scope: z.string().optional(),
    action: z.string().optional(),
    target: z.string().optional(),
    matchType: z.string().optional(),
    replacement: z.unknown().optional(),
    priority: z.number().int().optional(),
    isEnabled: z.boolean().optional(),
    bindingType: z.string().optional(),
    providerIds: z.array(z.number().int()).nullable().optional(),
    groupTags: z.array(z.string()).nullable().optional(),
    ruleMode: z.string().optional(),
    executionPhase: z.string().optional(),
    operations: z.array(z.unknown()).nullable().optional(),
  })
  .describe("更新 request filter 请求体");

export const RequestFiltersCacheRefreshResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
  })
  .describe("Request filters 缓存刷新结果")
  .openapi({ example: { count: 5 } });

export const RequestFiltersProviderOptionsResponseSchema = z
  .object({
    items: z.array(z.object({ id: z.number().int(), name: z.string() }).passthrough()),
  })
  .describe("Provider 选项");

export const RequestFiltersGroupOptionsResponseSchema = z
  .object({
    items: z.array(z.string()),
  })
  .describe("Provider group 选项");
