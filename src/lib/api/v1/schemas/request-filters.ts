import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const RequestFilterScopeSchema = z
  .enum(["header", "body"])
  .describe("Request filter scope.");
export const RequestFilterActionSchema = z
  .enum(["remove", "set", "json_path", "text_replace"])
  .describe("Request filter action.");
export const RequestFilterMatchTypeSchema = z
  .enum(["regex", "contains", "exact"])
  .nullable()
  .describe("Request filter match type.");
export const RequestFilterBindingTypeSchema = z
  .enum(["global", "providers", "groups"])
  .describe("Filter binding target type.");
export const RequestFilterRuleModeSchema = z
  .enum(["simple", "advanced"])
  .describe("Request filter rule mode.");
export const RequestFilterExecutionPhaseSchema = z
  .enum(["guard", "final"])
  .describe("Request filter execution phase.");

export const FilterOperationSchema = z
  .record(z.string(), z.unknown())
  .describe("Advanced request filter operation.");

export const RequestFilterSchema = z.object({
  id: z.number().int().positive().describe("Request filter id."),
  name: z.string().describe("Request filter display name."),
  description: z.string().nullable().describe("Optional description."),
  scope: RequestFilterScopeSchema,
  action: RequestFilterActionSchema,
  matchType: RequestFilterMatchTypeSchema,
  target: z.string().describe("Header name, body path, or text pattern target."),
  replacement: z.unknown().nullable().describe("Replacement value."),
  priority: z.number().int().describe("Filter priority."),
  isEnabled: z.boolean().describe("Whether the filter is enabled."),
  bindingType: RequestFilterBindingTypeSchema,
  providerIds: z.array(z.number().int().positive()).nullable().describe("Bound provider ids."),
  groupTags: z.array(z.string()).nullable().describe("Bound provider group tags."),
  ruleMode: RequestFilterRuleModeSchema,
  executionPhase: RequestFilterExecutionPhaseSchema,
  operations: z.array(FilterOperationSchema).nullable().describe("Advanced operations."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const RequestFilterListResponseSchema = z.object({
  items: z.array(RequestFilterSchema).describe("Request filters."),
});

export const RequestFilterCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe("Request filter display name."),
    description: z.string().trim().max(500).optional().describe("Optional description."),
    scope: RequestFilterScopeSchema,
    action: RequestFilterActionSchema,
    target: z.string().trim().max(500).describe("Header name, body path, or text pattern target."),
    matchType: RequestFilterMatchTypeSchema.optional().describe("Optional match type."),
    replacement: z.unknown().optional().describe("Replacement value."),
    priority: z.number().int().optional().describe("Filter priority."),
    bindingType: RequestFilterBindingTypeSchema.optional().describe("Binding type."),
    providerIds: z
      .array(z.number().int().positive())
      .nullable()
      .optional()
      .describe("Provider ids."),
    groupTags: z.array(z.string().min(1)).nullable().optional().describe("Provider group tags."),
    ruleMode: RequestFilterRuleModeSchema.optional().describe("Rule mode."),
    executionPhase: RequestFilterExecutionPhaseSchema.optional().describe("Execution phase."),
    operations: z
      .array(FilterOperationSchema)
      .nullable()
      .optional()
      .describe("Advanced operations."),
  })
  .strict();

export const RequestFilterUpdateSchema = RequestFilterCreateSchema.extend({
  isEnabled: z.boolean().optional().describe("Whether the filter is enabled."),
})
  .partial()
  .strict();

export const RequestFilterIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Request filter id."),
});

export const RequestFilterCacheRefreshResponseSchema = z.object({
  count: z.number().int().min(0).describe("Number of filters loaded into cache."),
});

export const RequestFilterProviderOptionSchema = z.object({
  id: z.number().int().positive().describe("Provider id."),
  name: z.string().describe("Provider name."),
});

export const RequestFilterProviderOptionsResponseSchema = z.object({
  items: z.array(RequestFilterProviderOptionSchema).describe("Provider options."),
});

export const RequestFilterGroupOptionsResponseSchema = z.object({
  items: z.array(z.string()).describe("Provider group tag options."),
});

export type RequestFilterResponse = z.infer<typeof RequestFilterSchema>;
export type RequestFilterCreateInput = z.infer<typeof RequestFilterCreateSchema>;
export type RequestFilterUpdateInput = z.infer<typeof RequestFilterUpdateSchema>;
