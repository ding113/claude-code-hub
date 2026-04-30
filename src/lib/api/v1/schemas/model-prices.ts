import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ModelPriceSourceSchema = z.enum(["litellm", "manual"]).describe("Model price source.");

export const ModelPriceModeSchema = z
  .enum(["chat", "image_generation", "completion", "responses"])
  .describe("Model pricing mode.");

export const ModelPriceNameParamSchema = z.object({
  modelName: z.string().min(1).describe("Model name."),
});

export const ModelPricePricingPinParamSchema = ModelPriceNameParamSchema.extend({
  pricingProviderKey: z.string().min(1).describe("Pricing provider key."),
});

export const ModelPriceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe("One-based page number."),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).describe("Page size."),
  search: z.string().trim().optional().describe("Optional model search text."),
  source: ModelPriceSourceSchema.optional().describe("Optional source filter."),
  litellmProvider: z.string().trim().optional().describe("Optional LiteLLM provider filter."),
});

export const ModelPriceCatalogQuerySchema = z.object({
  scope: z.enum(["chat", "all"]).default("chat").describe("Catalog scope."),
});

export const ModelPriceDataSchema = z
  .record(z.string(), z.unknown())
  .describe("Raw model pricing data.");

export const ModelPriceSchema = z.object({
  id: z.number().int().positive().describe("Model price record id."),
  modelName: z.string().describe("Model name."),
  priceData: ModelPriceDataSchema.describe("Model price payload."),
  source: ModelPriceSourceSchema.describe("Price source."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ModelPriceListResponseSchema = z.object({
  items: z.array(ModelPriceSchema).describe("Model price rows."),
  page: z.number().int().min(1).describe("Current page."),
  pageSize: z.number().int().min(1).describe("Page size."),
  total: z.number().int().min(0).describe("Total row count."),
  totalPages: z.number().int().min(0).describe("Total page count."),
});

export const ModelPriceCatalogItemSchema = z.object({
  modelName: z.string().describe("Model name."),
  litellmProvider: z.string().nullable().describe("LiteLLM provider."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ModelPriceCatalogResponseSchema = z.object({
  items: z.array(ModelPriceCatalogItemSchema).describe("Available model catalog items."),
});

export const ModelPriceExistsResponseSchema = z.object({
  exists: z.boolean().describe("Whether any price table records exist."),
});

export const ModelPriceUploadSchema = z
  .object({
    content: z.string().min(1).describe("JSON or TOML price table content."),
    overwriteManual: z.array(z.string()).optional().describe("Manual model names to overwrite."),
  })
  .strict();

export const ModelPriceOverwriteSchema = z
  .object({
    overwriteManual: z.array(z.string()).optional().describe("Manual model names to overwrite."),
  })
  .strict();

export const ModelPriceUpdateResultSchema = z.object({
  added: z.array(z.string()).describe("Added model names."),
  updated: z.array(z.string()).describe("Updated model names."),
  unchanged: z.array(z.string()).describe("Unchanged model names."),
  failed: z.array(z.string()).describe("Failed model names."),
  total: z.number().int().min(0).describe("Total processed models."),
  skippedConflicts: z.array(z.string()).optional().describe("Skipped manual-conflict model names."),
});

export const ModelPriceSyncConflictSchema = z.object({
  modelName: z.string().describe("Conflicting model name."),
  manualPrice: ModelPriceDataSchema.describe("Manual price payload."),
  litellmPrice: ModelPriceDataSchema.describe("LiteLLM price payload."),
});

export const ModelPriceSyncConflictCheckResponseSchema = z.object({
  hasConflicts: z.boolean().describe("Whether sync conflicts exist."),
  conflicts: z.array(ModelPriceSyncConflictSchema).describe("Sync conflicts."),
});

const NonNegativePriceSchema = z
  .number()
  .min(0)
  .finite()
  .optional()
  .describe("Optional non-negative price value.");

export const SingleModelPriceSchema = z
  .object({
    modelName: z.string().trim().min(1).describe("Model name."),
    displayName: z.string().trim().optional().describe("Display name."),
    mode: z.enum(["chat", "image_generation", "completion"]).describe("Model pricing mode."),
    litellmProvider: z.string().trim().optional().describe("LiteLLM provider."),
    supportsPromptCaching: z.boolean().optional().describe("Whether prompt caching is supported."),
    inputCostPerToken: NonNegativePriceSchema,
    outputCostPerToken: NonNegativePriceSchema,
    outputCostPerImage: NonNegativePriceSchema,
    inputCostPerRequest: NonNegativePriceSchema,
    cacheReadInputTokenCost: NonNegativePriceSchema,
    cacheCreationInputTokenCost: NonNegativePriceSchema,
    cacheCreationInputTokenCostAbove1hr: NonNegativePriceSchema,
    extraFieldsJson: z
      .string()
      .optional()
      .describe("Additional raw pricing fields as JSON object."),
  })
  .strict();

export const ModelPricePinRequestSchema = z
  .object({
    pricingProviderKey: z.string().trim().min(1).describe("Pricing provider key to pin."),
  })
  .strict();

export type ModelPriceListQuery = z.infer<typeof ModelPriceListQuerySchema>;
export type ModelPriceUploadInput = z.infer<typeof ModelPriceUploadSchema>;
export type ModelPriceOverwriteInput = z.infer<typeof ModelPriceOverwriteSchema>;
export type SingleModelPriceInput = z.infer<typeof SingleModelPriceSchema>;
export type ModelPricePinRequest = z.infer<typeof ModelPricePinRequestSchema>;
