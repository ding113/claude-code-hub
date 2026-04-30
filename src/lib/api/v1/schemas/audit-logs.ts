import { z } from "@hono/zod-openapi";
import { createCursorResponseSchema, IsoDateTimeStringSchema } from "./_common";

export const AuditCategorySchema = z
  .enum([
    "auth",
    "user",
    "provider",
    "provider_group",
    "system_settings",
    "key",
    "notification",
    "sensitive_word",
    "model_price",
  ])
  .describe("Audit log action category.");

export const AuditLogListQuerySchema = z.object({
  cursor: z.string().min(1).optional().describe("Opaque pagination cursor."),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Page size."),
  category: AuditCategorySchema.optional().describe("Optional action category filter."),
  success: z.coerce.boolean().optional().describe("Optional success filter."),
  from: IsoDateTimeStringSchema.optional().describe("Optional inclusive start time."),
  to: IsoDateTimeStringSchema.optional().describe("Optional inclusive end time."),
});

export const AuditLogIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Audit log id."),
});

export const AuditLogSchema = z.object({
  id: z.number().int().positive().describe("Audit log id."),
  actionCategory: AuditCategorySchema.describe("Action category."),
  actionType: z.string().describe("Action type."),
  targetType: z.string().nullable().describe("Target resource type."),
  targetId: z.string().nullable().describe("Target resource id."),
  targetName: z.string().nullable().describe("Target resource name."),
  beforeValue: z.unknown().nullable().describe("Value before the action."),
  afterValue: z.unknown().nullable().describe("Value after the action."),
  operatorUserId: z.number().int().nullable().describe("Operator user id."),
  operatorUserName: z.string().nullable().describe("Operator user name."),
  operatorKeyId: z.number().int().nullable().describe("Operator key id."),
  operatorKeyName: z.string().nullable().describe("Operator key name."),
  operatorIp: z.string().nullable().describe("Operator IP address."),
  userAgent: z.string().nullable().describe("Operator user agent."),
  success: z.boolean().describe("Whether the audited action succeeded."),
  errorMessage: z.string().nullable().describe("Action error message."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
});

export const AuditLogListResponseSchema = createCursorResponseSchema(AuditLogSchema).describe(
  "Cursor-paginated audit log response."
);

export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;
