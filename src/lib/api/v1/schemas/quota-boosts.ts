import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const BoostWindowSchema = z
  .enum(["5h", "daily", "weekly", "monthly", "total"])
  .describe("Quota boost time window.");

export const QuotaBoostGrantSchema = z.object({
  id: z.number().int().positive().describe("Grant id."),
  userId: z.number().int().positive().describe("Target user id."),
  modelGroupId: z.number().int().positive().describe("Target model group id."),
  window: BoostWindowSchema,
  amountUsd: z.string().describe("Boost amount in USD (decimal string)."),
  validFrom: IsoDateTimeStringSchema.describe("Grant valid-from timestamp."),
  validTo: IsoDateTimeStringSchema.describe("Grant valid-to timestamp (exclusive)."),
  note: z.string().nullable().describe("Optional admin note."),
  createdBy: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Admin user id who created the grant."),
  createdAt: IsoDateTimeStringSchema.describe("Row creation timestamp."),
  updatedAt: IsoDateTimeStringSchema.describe("Row update timestamp."),
});

export const QuotaBoostGrantListResponseSchema = z.object({
  items: z.array(QuotaBoostGrantSchema).describe("Quota boost grants."),
});

export const QuotaBoostGrantCreateSchema = z
  .object({
    userId: z.number().int().positive().describe("Target user id (personal users only)."),
    modelGroupId: z.number().int().positive().describe("Target model group id."),
    window: BoostWindowSchema,
    amountUsd: z
      .number()
      .positive()
      .max(1_000_000)
      .describe("Boost amount in USD. Must be a positive number."),
    validFrom: z
      .string()
      .datetime({ offset: true })
      .describe("Grant start time (ISO 8601 with timezone)."),
    validTo: z
      .string()
      .datetime({ offset: true })
      .describe("Grant expiry time (ISO 8601 with timezone). Must be after validFrom."),
    note: z.string().max(500).optional().nullable().describe("Optional admin note."),
  })
  .strict()
  .refine((d) => new Date(d.validTo) > new Date(d.validFrom), {
    message: "validTo must be after validFrom.",
    path: ["validTo"],
  });

export const QuotaBoostGrantIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Quota boost grant id."),
});

export const QuotaBoostGrantListQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional().describe("Filter by user id."),
  modelGroupId: z.coerce.number().int().positive().optional().describe("Filter by model group id."),
});

export type QuotaBoostGrantResponse = z.infer<typeof QuotaBoostGrantSchema>;
export type QuotaBoostGrantCreateInput = z.infer<typeof QuotaBoostGrantCreateSchema>;
