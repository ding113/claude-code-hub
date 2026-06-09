import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const UserGroupSchema = z.object({
  id: z.number().int().positive().describe("User group id."),
  tag: z.string().describe("Tag used to derive group membership from users.tags."),
  name: z.string().nullable().describe("Display name for the group."),
  description: z.string().nullable().describe("Optional description."),
  memberCount: z.number().int().min(0).optional().describe("Number of users in this group."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const UserGroupListResponseSchema = z.object({
  items: z.array(UserGroupSchema).describe("User groups."),
});

export const UserGroupCreateSchema = z
  .object({
    tag: z.string().trim().min(1).max(255).describe("Unique tag for membership derivation."),
    name: z.string().trim().min(1).max(128).nullable().optional().describe("Display name."),
    description: z.string().max(5000).nullable().optional().describe("Optional description."),
  })
  .strict();

export const UserGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).nullable().optional().describe("Display name."),
    description: z.string().max(5000).nullable().optional().describe("Optional description."),
  })
  .strict();

export const UserGroupIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("User group id."),
});

export type UserGroupResponse = z.infer<typeof UserGroupSchema>;
export type UserGroupCreateInput = z.infer<typeof UserGroupCreateSchema>;
export type UserGroupUpdateInput = z.infer<typeof UserGroupUpdateSchema>;
