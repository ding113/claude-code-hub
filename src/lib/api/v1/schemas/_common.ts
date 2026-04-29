import { z } from "@hono/zod-openapi";

export const ApiVersionSchema = z.literal("1.0.0").describe("Management API version.");

export const RequiredAccessSchema = z
  .enum(["public", "read", "admin"])
  .describe("Required access tier for the endpoint.");

export const InvalidParamSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])).describe("Path to the invalid input field."),
  code: z.string().describe("Machine-readable validation error code."),
  message: z.string().describe("Validation error message."),
});

export const ProblemJsonSchema = z.object({
  type: z.string().min(1).describe("Stable problem type URI or URN."),
  title: z.string().describe("Short problem title."),
  status: z.number().int().min(100).max(599).describe("HTTP status code."),
  detail: z.string().describe("Human-readable error detail."),
  instance: z.string().describe("Request path that produced the problem."),
  errorCode: z.string().describe("Application error code for frontend i18n."),
  errorParams: z.record(z.string(), z.unknown()).optional().describe("Optional i18n parameters."),
  traceId: z.string().optional().describe("Optional request trace identifier."),
  invalidParams: z.array(InvalidParamSchema).optional().describe("Validation failure details."),
});

export const IsoDateTimeStringSchema = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 date-time string.");

export const PositiveIntIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Positive integer resource id."),
});

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe("One-based page number."),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Page size, capped at 100."),
});

export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional().describe("Opaque pagination cursor."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Cursor page size, capped at 100."),
});

export const PageInfoSchema = z.object({
  page: z.number().int().min(1).describe("Current one-based page number."),
  pageSize: z.number().int().min(1).describe("Page size used for this response."),
  total: z.number().int().min(0).describe("Total item count."),
  totalPages: z.number().int().min(0).describe("Total page count."),
});

export const CursorPageInfoSchema = z.object({
  nextCursor: z.string().nullable().describe("Next opaque cursor, or null when exhausted."),
  hasMore: z.boolean().describe("Whether more items can be fetched."),
  limit: z.number().int().min(1).describe("Limit used for this response."),
});

export const ProviderTypeSchema = z
  .enum(["claude", "codex", "gemini", "openai-compatible"])
  .describe("Supported provider type. Hidden legacy provider types are intentionally excluded.");

export function createPageResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema).describe("Items in the current page."),
    pageInfo: PageInfoSchema.describe("Offset pagination metadata."),
  });
}

export function createCursorResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema).describe("Items in the current cursor page."),
    pageInfo: CursorPageInfoSchema.describe("Cursor pagination metadata."),
  });
}
