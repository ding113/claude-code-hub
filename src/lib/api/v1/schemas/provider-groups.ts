import { z } from "@hono/zod-openapi";
import { PUBLIC_PROVIDER_TYPE_VALUES } from "@/lib/api/v1/_shared/constants";
import { IsoDateTimeStringSchema } from "./_common";

const ProviderGroupMatchRuleSchema = z
  .object({
    matchType: z.enum(["exact", "prefix", "suffix", "contains", "regex"]),
    pattern: z.string().trim().min(1).max(200),
  })
  .strict();

const ProviderGroupModelMatchRuleSchema = z
  .object({
    matchType: z.enum(["exact", "prefix", "suffix", "contains", "regex"]),
    pattern: z.string().trim().min(1).max(200),
  })
  .strict();

const ProviderGroupSharedSettingsSchema = z
  .object({
    providerType: z.enum(PUBLIC_PROVIDER_TYPE_VALUES).nullable().optional(),
    priority: z.number().int().nullable().optional(),
    weight: z.number().nullable().optional(),
    costMultiplier: z.number().min(0).nullable().optional(),
    preserveClientIp: z.boolean().nullable().optional(),
    disableSessionReuse: z.boolean().nullable().optional(),
    proxyUrl: z.string().nullable().optional(),
    proxyFallbackToDirect: z.boolean().nullable().optional(),
    maxRetryAttempts: z.number().int().nullable().optional(),
    circuitBreakerFailureThreshold: z.number().int().nullable().optional(),
    circuitBreakerOpenDuration: z.number().int().nullable().optional(),
    circuitBreakerHalfOpenSuccessThreshold: z.number().int().nullable().optional(),
    limit5hUsd: z.number().nullable().optional(),
    limitDailyUsd: z.number().nullable().optional(),
    limitWeeklyUsd: z.number().nullable().optional(),
    limitMonthlyUsd: z.number().nullable().optional(),
    limitTotalUsd: z.number().nullable().optional(),
    limitConcurrentSessions: z.number().int().nullable().optional(),
  })
  .strict()
  .nullable()
  .optional()
  .describe("Shared provider defaults for this group (no website/endpoint/timeouts).");

export const ProviderGroupSchema = z.object({
  id: z.number().int().positive().describe("Provider group id."),
  name: z.string().describe("Provider group name."),
  costMultiplier: z.number().min(0).describe("Group cost multiplier."),
  description: z.string().nullable().describe("Optional group description."),
  healthTestModel: z
    .string()
    .nullable()
    .optional()
    .describe("Default scheduled health-test model; null/empty = skip scheduled tests."),
  sharedSettings: ProviderGroupSharedSettingsSchema,
  sortOrder: z.number().int().optional().describe("Keyword match priority; lower runs first."),
  matchRules: z
    .array(ProviderGroupMatchRuleSchema)
    .nullable()
    .optional()
    .describe("Keyword rules for classifying upstream site groups into this pool."),
  modelMatchRules: z
    .array(ProviderGroupModelMatchRuleSchema)
    .nullable()
    .optional()
    .describe("Request-model rules for providers in this pool."),
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
    healthTestModel: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Default scheduled health-test model; empty = skip scheduled tests."),
    sharedSettings: ProviderGroupSharedSettingsSchema,
    applySharedSettingsToMembers: z
      .boolean()
      .optional()
      .describe("When true, push sharedSettings onto all providers in this group."),
    sortOrder: z.number().int().optional().describe("Keyword match priority."),
    matchRules: z
      .array(ProviderGroupMatchRuleSchema)
      .nullable()
      .optional()
      .describe("Keyword rules for site-group classification."),
    modelMatchRules: z
      .array(ProviderGroupModelMatchRuleSchema)
      .nullable()
      .optional()
      .describe("Request-model rules for providers in this pool."),
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
    healthTestModel: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Default scheduled health-test model; empty = skip scheduled tests."),
    sharedSettings: ProviderGroupSharedSettingsSchema,
    applySharedSettingsToMembers: z
      .boolean()
      .optional()
      .describe("When true, push sharedSettings onto all providers in this group."),
    sortOrder: z.number().int().optional().describe("Keyword match priority."),
    matchRules: z
      .array(ProviderGroupMatchRuleSchema)
      .nullable()
      .optional()
      .describe("Keyword rules for site-group classification."),
    modelMatchRules: z
      .array(ProviderGroupModelMatchRuleSchema)
      .nullable()
      .optional()
      .describe("Request-model rules for providers in this pool."),
  })
  .strict();

export const ProviderGroupReorderSchema = z
  .object({
    orderedIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe("Provider group ids in match priority order (top first)."),
  })
  .strict();

export const ProviderGroupIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Provider group id."),
});

export type ProviderGroupResponse = z.infer<typeof ProviderGroupSchema>;
export type ProviderGroupCreateInput = z.infer<typeof ProviderGroupCreateSchema>;
export type ProviderGroupUpdateInput = z.infer<typeof ProviderGroupUpdateSchema>;
export type ProviderGroupReorderInput = z.infer<typeof ProviderGroupReorderSchema>;
