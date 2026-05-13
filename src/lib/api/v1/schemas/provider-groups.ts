import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ProviderGroupSchema = z.object({
  id: z.number().int().positive().describe("Provider group id."),
  name: z.string().describe("Provider group name."),
  costMultiplier: z.number().min(0).describe("Group cost multiplier."),
  description: z.string().nullable().describe("Optional group description."),
  providerCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Number of providers using the group."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ProviderGroupListResponseSchema = z.object({
  items: z.array(ProviderGroupSchema).describe("Provider groups."),
});

export const ProviderGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe("Provider group name."),
    costMultiplier: z.number().min(0).optional().describe("Group cost multiplier."),
    description: z.string().max(5000).optional().describe("Optional group description."),
  })
  .strict();

export const ProviderGroupUpdateSchema = z
  .object({
    costMultiplier: z.number().min(0).optional().describe("Group cost multiplier."),
    description: z.string().max(5000).nullable().optional().describe("Optional group description."),
    descriptionNote: z
      .string()
      .max(5000)
      .nullable()
      .optional()
      .describe("Optional plain description note."),
  })
  .strict();

export const ProviderGroupIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Provider group id."),
});

export type ProviderGroupResponse = z.infer<typeof ProviderGroupSchema>;
export type ProviderGroupCreateInput = z.infer<typeof ProviderGroupCreateSchema>;
export type ProviderGroupUpdateInput = z.infer<typeof ProviderGroupUpdateSchema>;
