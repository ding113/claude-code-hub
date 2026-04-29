import { z } from "@hono/zod-openapi";

const NumberQuerySchema = z.coerce.number().optional();
const BooleanQuerySchema = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true")
  .optional();

export const UsageLogsQuerySchema = z.object({
  cursorCreatedAt: z.string().optional().describe("Cursor createdAt component."),
  cursorId: z.coerce.number().int().positive().optional().describe("Cursor id component."),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Cursor page size."),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Offset page number for legacy listing."),
  pageSize: z.coerce.number().int().min(1).max(100).optional().describe("Offset page size."),
  sessionId: z.string().optional().describe("Session id filter."),
  userId: NumberQuerySchema.describe("User id filter."),
  keyId: NumberQuerySchema.describe("Key id filter."),
  providerId: NumberQuerySchema.describe("Provider id filter."),
  model: z.string().optional().describe("Model filter."),
  statusCode: z.coerce.number().int().optional().describe("HTTP status code filter."),
  excludeStatusCode200: BooleanQuerySchema.describe("Exclude successful responses."),
  endpoint: z.string().optional().describe("Endpoint filter."),
  minRetryCount: z.coerce.number().int().min(0).optional().describe("Minimum retry count."),
  startTime: NumberQuerySchema.describe("Start timestamp in milliseconds."),
  endTime: NumberQuerySchema.describe("End timestamp in milliseconds."),
});

export const UsageLogsExportCreateSchema = UsageLogsQuerySchema.omit({
  cursorCreatedAt: true,
  cursorId: true,
  limit: true,
  page: true,
  pageSize: true,
}).strict();

export const UsageLogExportJobParamSchema = z.object({
  jobId: z.string().min(1).describe("Export job id."),
});

export const UsageLogSessionSuggestionsQuerySchema = z.object({
  term: z.string().optional().describe("Session id search term."),
  q: z.string().optional().describe("Alias for the session id search term."),
  userId: NumberQuerySchema.describe("User id filter."),
  keyId: NumberQuerySchema.describe("Key id filter."),
  providerId: NumberQuerySchema.describe("Provider id filter."),
});

export const GenericUsageLogResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Usage log API response object.");

export const StringListResponseSchema = z.object({
  items: z.array(z.string()).describe("String values."),
});

export const NumberListResponseSchema = z.object({
  items: z.array(z.number()).describe("Numeric values."),
});

export type UsageLogsQueryInput = z.infer<typeof UsageLogsQuerySchema>;
export type UsageLogsExportCreateInput = z.infer<typeof UsageLogsExportCreateSchema>;
export type UsageLogsActionQueryInput = Omit<
  UsageLogsQueryInput,
  "cursorCreatedAt" | "cursorId"
> & {
  cursor?: { createdAt: string; id: number };
};
