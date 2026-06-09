import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const LimitSubjectTypeSchema = z
  .enum(["user", "key", "user_group"])
  .describe("Limit subject dimension.");

export const ModelLimitResetModeSchema = z
  .enum(["fixed", "rolling"])
  .describe("5-hour window reset mode.");

const UsdLimitSchema = z
  .number()
  .min(0)
  .nullable()
  .optional()
  .describe("USD cost limit; null clears it (unlimited).");

export const ModelGroupLimitSchema = z.object({
  id: z.number().int().positive().describe("Limit row id."),
  subjectType: LimitSubjectTypeSchema,
  subjectId: z.number().int().positive().describe("User id, key id, or user-group id."),
  modelGroupId: z.number().int().positive().describe("Model group id."),
  rpmLimit: z.number().int().min(0).nullable().describe("Reserved RPM limit (unused in v1)."),
  limit5hUsd: z.number().min(0).nullable().describe("5-hour USD cost limit."),
  limit5hResetMode: ModelLimitResetModeSchema,
  dailyLimitUsd: z.number().min(0).nullable().describe("Daily USD cost limit."),
  limitWeeklyUsd: z.number().min(0).nullable().describe("Weekly USD cost limit."),
  limitMonthlyUsd: z.number().min(0).nullable().describe("Monthly USD cost limit."),
  limitTotalUsd: z.number().min(0).nullable().describe("All-time USD cost limit."),
  limit5hCostResetAt: IsoDateTimeStringSchema.nullable().describe("5-hour anchor reset time."),
  keyPreview: z
    .string()
    .nullable()
    .optional()
    .describe("Masked key value for display (key subject type only)."),
});

export const ModelGroupLimitListResponseSchema = z.object({
  items: z.array(ModelGroupLimitSchema).describe("Model group limits."),
});

export const ModelGroupLimitListQuerySchema = z.object({
  subjectType: LimitSubjectTypeSchema.optional(),
  subjectId: z.coerce.number().int().positive().optional().describe("Filter by subject id."),
  modelGroupId: z.coerce.number().int().positive().optional().describe("Filter by model group id."),
});

export const ModelGroupLimitUpsertSchema = z
  .object({
    subjectType: LimitSubjectTypeSchema,
    subjectId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("User id, key id, or user-group id."),
    keyValue: z
      .string()
      .optional()
      .describe("Raw key string (resolved to id server-side when subjectType=key)."),
    modelGroupId: z.number().int().positive().describe("Model group id."),
    rpmLimit: z.number().int().min(0).nullable().optional().describe("Reserved RPM limit."),
    limit5hUsd: UsdLimitSchema,
    limit5hResetMode: ModelLimitResetModeSchema.optional(),
    dailyLimitUsd: UsdLimitSchema,
    limitWeeklyUsd: UsdLimitSchema,
    limitMonthlyUsd: UsdLimitSchema,
    limitTotalUsd: UsdLimitSchema,
    limit5hCostResetAt: z.coerce
      .date()
      .nullable()
      .optional()
      .describe("5-hour anchor reset time (ISO 8601)."),
  })
  .strict();

export const ModelGroupLimitIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Limit row id."),
});

export type ModelGroupLimitResponse = z.infer<typeof ModelGroupLimitSchema>;
export type ModelGroupLimitUpsertInput = z.infer<typeof ModelGroupLimitUpsertSchema>;
