import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const SensitiveWordMatchTypeSchema = z
  .enum(["contains", "exact", "regex"])
  .describe("Sensitive word match type.");

export const SensitiveWordSchema = z.object({
  id: z.number().int().positive().describe("Sensitive word id."),
  word: z.string().describe("Sensitive word or pattern."),
  matchType: SensitiveWordMatchTypeSchema,
  description: z.string().nullable().describe("Optional description."),
  isEnabled: z.boolean().describe("Whether the rule is enabled."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const SensitiveWordListResponseSchema = z.object({
  items: z.array(SensitiveWordSchema).describe("Sensitive word rules."),
});

export const SensitiveWordCreateSchema = z
  .object({
    word: z.string().trim().min(1).max(500).describe("Sensitive word or pattern."),
    matchType: SensitiveWordMatchTypeSchema,
    description: z.string().trim().max(500).optional().describe("Optional description."),
  })
  .strict();

export const SensitiveWordUpdateSchema = SensitiveWordCreateSchema.extend({
  isEnabled: z.boolean().optional().describe("Whether the rule is enabled."),
})
  .partial()
  .strict();

export const SensitiveWordIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Sensitive word id."),
});

export const DetectorStatsSchema = z
  .record(z.string(), z.unknown())
  .describe("Detector cache statistics.");

export const SensitiveWordCacheRefreshResponseSchema = z.object({
  stats: DetectorStatsSchema.describe("Refreshed detector cache statistics."),
});

export type SensitiveWordResponse = z.infer<typeof SensitiveWordSchema>;
export type SensitiveWordCreateInput = z.infer<typeof SensitiveWordCreateSchema>;
export type SensitiveWordUpdateInput = z.infer<typeof SensitiveWordUpdateSchema>;
