/**
 * /api/v1 provider-groups 资源 schema
 *
 * - getProviderGroups -> ProviderGroupWithCount[];
 * - createProviderGroup / updateProviderGroup / deleteProviderGroup 与 admin 权限。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 输入 ====================

export const ProviderGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).describe("分组名称").openapi({ example: "team-a" }),
    costMultiplier: z
      .number()
      .min(0)
      .optional()
      .describe("成本倍率（默认 1.0）")
      .openapi({ example: 1.0 }),
    description: z.string().max(2000).nullable().optional().describe("分组描述"),
  })
  .describe("创建 provider group 的请求体")
  .openapi({ example: { name: "team-a", costMultiplier: 1.0 } });

export type ProviderGroupCreateInput = z.infer<typeof ProviderGroupCreateSchema>;

export const ProviderGroupUpdateSchema = z
  .object({
    costMultiplier: z.number().min(0).optional(),
    description: z.string().max(2000).nullable().optional(),
    descriptionNote: z.string().max(2000).nullable().optional(),
  })
  .describe("更新 provider group 的请求体（局部更新）")
  .openapi({ example: { costMultiplier: 1.5 } });

export type ProviderGroupUpdateInput = z.infer<typeof ProviderGroupUpdateSchema>;

// ==================== 输出 ====================

export const ProviderGroupResponseSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    costMultiplier: z.number(),
    description: z.string().nullable(),
    providerCount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("当 list 时返回的 provider 计数"),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .describe("Provider Group 响应");

export type ProviderGroupResponse = z.infer<typeof ProviderGroupResponseSchema>;

export const ProviderGroupListResponseSchema = z
  .object({
    items: z.array(ProviderGroupResponseSchema),
  })
  .describe("Provider Group 列表响应");

export type ProviderGroupListResponse = z.infer<typeof ProviderGroupListResponseSchema>;

// ==================== 序列化 ====================

function dateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

export function serializeProviderGroup(group: Record<string, unknown>): ProviderGroupResponse {
  const g = group as Record<string, unknown> & {
    id: number;
    name: string;
    costMultiplier: number | string;
    description: string | null;
    providerCount?: number;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  };
  return {
    id: g.id,
    name: g.name,
    costMultiplier:
      typeof g.costMultiplier === "number" ? g.costMultiplier : Number(g.costMultiplier),
    description: g.description ?? null,
    providerCount: g.providerCount,
    createdAt: dateToIso(g.createdAt),
    updatedAt: dateToIso(g.updatedAt),
  };
}
