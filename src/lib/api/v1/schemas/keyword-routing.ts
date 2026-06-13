import { z } from "@hono/zod-openapi";
import {
  DESCRIPTION_MAX_LENGTH,
  KEYWORD_MAX_LENGTH,
  MODEL_MAX_LENGTH,
  PRIORITY_ABS_LIMIT,
} from "@/lib/validation/keyword-routing-constants";
import { IsoDateTimeStringSchema } from "./_common";

export const KeywordRoutingRuleSchema = z.object({
  id: z.number().int().positive().describe("Keyword routing rule id."),
  keyword: z.string().describe("Keyword to match in request texts."),
  sourceModel: z
    .string()
    .nullable()
    .describe("Source model filter; null matches any requested model."),
  targetModel: z.string().describe("Target model to route matched requests to."),
  caseSensitive: z.boolean().describe("Whether keyword matching is case sensitive."),
  priority: z.number().int().describe("Rule priority; lower values are evaluated first."),
  description: z.string().nullable().describe("Optional description."),
  isEnabled: z.boolean().describe("Whether the rule is enabled."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const KeywordRoutingRuleListResponseSchema = z.object({
  items: z.array(KeywordRoutingRuleSchema).describe("Keyword routing rules."),
});

export const KeywordRoutingRuleCreateSchema = z
  .object({
    keyword: z
      .string()
      .trim()
      .min(1)
      .max(KEYWORD_MAX_LENGTH)
      .describe("Keyword to match in request texts."),
    sourceModel: z
      .string()
      .trim()
      .max(MODEL_MAX_LENGTH)
      .nullable()
      .optional()
      .describe("Source model filter; null or empty matches any requested model."),
    targetModel: z
      .string()
      .trim()
      .min(1)
      .max(MODEL_MAX_LENGTH)
      .describe("Target model to route matched requests to."),
    caseSensitive: z.boolean().optional().describe("Whether keyword matching is case sensitive."),
    priority: z
      .number()
      .int()
      .min(-PRIORITY_ABS_LIMIT)
      .max(PRIORITY_ABS_LIMIT)
      .optional()
      .describe("Rule priority; lower values are evaluated first."),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional()
      .describe("Optional description."),
  })
  .strict();

export const KeywordRoutingRuleUpdateSchema = KeywordRoutingRuleCreateSchema.extend({
  isEnabled: z.boolean().optional().describe("Whether the rule is enabled."),
})
  .partial()
  .strict();

export const KeywordRoutingRuleIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Keyword routing rule id."),
});

export const KeywordRoutingCacheStatsSchema = z
  .object({
    ruleCount: z.number().int().nonnegative().describe("Number of cached enabled rules."),
    lastReloadTime: z.number().describe("Last reload time as a unix epoch in milliseconds."),
    isLoading: z.boolean().describe("Whether a reload is currently in progress."),
  })
  .describe("Keyword routing engine cache statistics.");

export const KeywordRoutingCacheRefreshResponseSchema = z.object({
  stats: KeywordRoutingCacheStatsSchema.describe("Refreshed engine cache statistics."),
});

export type KeywordRoutingRuleResponse = z.infer<typeof KeywordRoutingRuleSchema>;
export type KeywordRoutingRuleCreateInput = z.infer<typeof KeywordRoutingRuleCreateSchema>;
export type KeywordRoutingRuleUpdateInput = z.infer<typeof KeywordRoutingRuleUpdateSchema>;
