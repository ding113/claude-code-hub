import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ModelGroupSchema = z.object({
  id: z.number().int().positive().describe("Model group id."),
  name: z.string().describe("Model group name."),
  description: z.string().nullable().describe("Optional description."),
  isSingleton: z
    .boolean()
    .describe("True when this group wraps a single model (singleton shortcut)."),
  members: z.array(z.string()).describe("Model names belonging to this group."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ModelGroupListResponseSchema = z.object({
  items: z.array(ModelGroupSchema).describe("Model groups."),
});

export const ModelGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).describe("Model group name (unique)."),
    description: z.string().max(2000).nullable().optional().describe("Optional description."),
    isSingleton: z.boolean().optional().describe("Mark as singleton group."),
  })
  .strict();

export const ModelGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional().describe("New name."),
    description: z.string().max(2000).nullable().optional().describe("New description."),
  })
  .strict();

export const ModelGroupIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Model group id."),
});

export const ModelGroupMemberBodySchema = z
  .object({
    model: z.string().trim().min(1).max(128).describe("Model name to add."),
  })
  .strict();

export const ModelGroupMemberQuerySchema = z.object({
  model: z.string().trim().min(1).max(128).describe("Model name to remove."),
});

export const SingletonCreateSchema = z
  .object({
    model: z.string().trim().min(1).max(128).describe("Model name."),
    name: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe("Optional group name (defaults to model name)."),
  })
  .strict();

export type ModelGroupResponse = z.infer<typeof ModelGroupSchema>;
export type ModelGroupCreateInput = z.infer<typeof ModelGroupCreateSchema>;
export type ModelGroupUpdateInput = z.infer<typeof ModelGroupUpdateSchema>;
