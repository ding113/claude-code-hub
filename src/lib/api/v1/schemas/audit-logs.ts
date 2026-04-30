/**
 * /api/v1 audit-logs 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const AuditLogItemSchema = z
  .object({
    id: z.number().int(),
    category: z.string(),
    action: z.string(),
    success: z.boolean(),
    createdAt: z.string().nullable().optional(),
  })
  .passthrough()
  .describe("Audit log 单条记录（passthrough）")
  .openapi({
    example: { id: 1, category: "user", action: "user.create", success: true },
  });

export type AuditLogItem = z.infer<typeof AuditLogItemSchema>;

export const AuditLogsListResponseSchema = z
  .object({
    items: z.array(AuditLogItemSchema),
    pageInfo: z.object({
      nextCursor: z
        .object({})
        .passthrough()
        .nullable()
        .describe("Repository AuditLogCursor or null"),
      hasMore: z.boolean(),
    }),
  })
  .describe("Audit logs 列表响应")
  .openapi({
    example: {
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
    },
  });

export type AuditLogsListResponse = z.infer<typeof AuditLogsListResponseSchema>;

export const AuditLogDetailResponseSchema = AuditLogItemSchema.describe("Audit log 详情");
export type AuditLogDetailResponse = z.infer<typeof AuditLogDetailResponseSchema>;
