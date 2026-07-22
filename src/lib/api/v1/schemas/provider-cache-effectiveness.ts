import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ProviderCacheEffectivenessListQuerySchema = z.object({
  providerId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional provider id filter."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of windows to return, capped at 200."),
});

export const ProviderCacheEffectivenessWindowSchema = z.object({
  id: z.number().int().positive().describe("Aggregation window row id."),
  providerId: z.number().int().positive().describe("Provider id."),
  model: z.string().describe("Model name the window was aggregated for."),
  cacheTtlBucket: z.string().describe("Cache TTL bucket, e.g. 5m or 1h."),
  windowStart: IsoDateTimeStringSchema.describe("Aggregation window start."),
  windowEnd: IsoDateTimeStringSchema.describe("Aggregation window end."),
  sampleCount: z.number().int().min(0).describe("Total samples in the window."),
  eligibleCount: z.number().int().min(0).describe("Samples eligible for cache observation."),
  theoreticalCacheTokens: z
    .number()
    .int()
    .min(0)
    .describe("Theoretical cacheable prompt tokens in the window."),
  observedCacheReadTokens: z
    .number()
    .int()
    .min(0)
    .describe("Observed cache read tokens in the window."),
  rawEffectivenessBp: z
    .number()
    .int()
    .describe("Raw observed/theoretical ratio in basis points (1/100 of a percent)."),
  confidenceBp: z.number().int().describe("Confidence of the raw ratio in basis points."),
  effectivenessBp: z
    .number()
    .int()
    .describe("Confidence-adjusted effectiveness score in basis points."),
  createdAt: IsoDateTimeStringSchema.nullable().describe("Row creation time."),
});

export const ProviderCacheEffectivenessListResponseSchema = z.object({
  items: z
    .array(ProviderCacheEffectivenessWindowSchema)
    .describe("Cache effectiveness windows ordered by window end descending."),
});

export type ProviderCacheEffectivenessListQuery = z.infer<
  typeof ProviderCacheEffectivenessListQuerySchema
>;
