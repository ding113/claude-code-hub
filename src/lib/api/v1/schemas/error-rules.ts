import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ErrorRuleCategorySchema = z
  .enum([
    "prompt_limit",
    "content_filter",
    "pdf_limit",
    "thinking_error",
    "parameter_error",
    "invalid_request",
    "cache_limit",
  ])
  .describe("Error rule category.");

export const ErrorRuleMatchTypeSchema = z
  .enum(["contains", "exact", "regex"])
  .describe("Error rule match type.");

export const ErrorOverrideResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Provider-specific error response override payload.");

export const ErrorRuleSchema = z.object({
  id: z.number().int().positive().describe("Error rule id."),
  pattern: z.string().describe("Error message pattern."),
  matchType: ErrorRuleMatchTypeSchema,
  category: ErrorRuleCategorySchema.or(z.string()).describe("Error category."),
  description: z.string().nullable().describe("Optional description."),
  overrideResponse: ErrorOverrideResponseSchema.nullable().describe("Optional response override."),
  overrideStatusCode: z
    .number()
    .int()
    .min(400)
    .max(599)
    .nullable()
    .describe("Optional status override."),
  isEnabled: z.boolean().describe("Whether the rule is enabled."),
  isDefault: z.boolean().describe("Whether this is a built-in default rule."),
  priority: z.number().int().describe("Rule priority."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ErrorRuleListResponseSchema = z.object({
  items: z.array(ErrorRuleSchema).describe("Error rules."),
});

export const ErrorRuleCreateSchema = z
  .object({
    pattern: z.string().trim().min(1).max(1000).describe("Error message pattern."),
    category: ErrorRuleCategorySchema,
    matchType: ErrorRuleMatchTypeSchema.optional().describe("Match type."),
    description: z.string().trim().max(500).optional().describe("Optional description."),
    overrideResponse: ErrorOverrideResponseSchema.nullable()
      .optional()
      .describe("Optional response override."),
    overrideStatusCode: z
      .number()
      .int()
      .min(400)
      .max(599)
      .nullable()
      .optional()
      .describe("Optional status override."),
  })
  .strict();

export const ErrorRuleUpdateSchema = ErrorRuleCreateSchema.extend({
  isEnabled: z.boolean().optional().describe("Whether the rule is enabled."),
  priority: z.number().int().optional().describe("Rule priority."),
})
  .partial()
  .strict();

export const ErrorRuleIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Error rule id."),
});

export const ErrorRulesDetectorStatsSchema = z
  .record(z.string(), z.unknown())
  .describe("Error rule detector cache statistics.");

export const ErrorRulesCacheRefreshResponseSchema = z.object({
  stats: ErrorRulesDetectorStatsSchema.describe("Refreshed detector cache statistics."),
  syncResult: z
    .object({
      inserted: z.number().int().min(0).describe("Inserted default rule count."),
      updated: z.number().int().min(0).describe("Updated default rule count."),
      skipped: z.number().int().min(0).describe("Skipped custom rule count."),
      deleted: z.number().int().min(0).describe("Deleted stale default rule count."),
    })
    .describe("Default rule sync result."),
});

export const ErrorRuleTestRequestSchema = z
  .object({
    message: z.string().trim().min(1).describe("Error message to test."),
  })
  .strict();

export const ErrorRuleTestResponseSchema = z.object({
  matched: z.boolean().describe("Whether a rule matched."),
  rule: z
    .object({
      category: z.string().describe("Matched category."),
      pattern: z.string().describe("Matched pattern."),
      matchType: ErrorRuleMatchTypeSchema,
      overrideResponse: ErrorOverrideResponseSchema.nullable().describe(
        "Matched override response."
      ),
      overrideStatusCode: z.number().int().nullable().describe("Matched override status code."),
    })
    .optional()
    .describe("Matched rule summary."),
  finalResponse: ErrorOverrideResponseSchema.nullable().describe("Final response override."),
  finalStatusCode: z.number().int().nullable().describe("Final status override."),
  warnings: z.array(z.string()).optional().describe("Warnings produced by the test."),
});

export type ErrorRuleResponse = z.infer<typeof ErrorRuleSchema>;
export type ErrorRuleCreateInput = z.infer<typeof ErrorRuleCreateSchema>;
export type ErrorRuleUpdateInput = z.infer<typeof ErrorRuleUpdateSchema>;
