import { z } from "@hono/zod-openapi";

const NumberQuerySchema = z.coerce.number().optional();
const BooleanQuerySchema = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true")
  .optional();

export const MeUsageLogsQuerySchema = z.object({
  cursorCreatedAt: z.string().optional().describe("Cursor createdAt component."),
  cursorId: z.coerce.number().int().positive().optional().describe("Cursor id component."),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Cursor page size."),
  page: z.coerce.number().int().min(1).optional().describe("Offset page number."),
  pageSize: z.coerce.number().int().min(1).max(100).optional().describe("Offset page size."),
  startDate: z.string().optional().describe("Start date in YYYY-MM-DD."),
  endDate: z.string().optional().describe("End date in YYYY-MM-DD."),
  startTime: NumberQuerySchema.describe("Start timestamp in milliseconds."),
  endTime: NumberQuerySchema.describe("End timestamp in milliseconds."),
  sessionId: z.string().optional().describe("Session id filter."),
  model: z.string().optional().describe("Model filter."),
  statusCode: z.coerce.number().int().optional().describe("HTTP status code filter."),
  excludeStatusCode200: BooleanQuerySchema.describe("Exclude successful responses."),
  endpoint: z.string().optional().describe("Endpoint filter."),
  minRetryCount: z.coerce.number().int().min(0).optional().describe("Minimum retry count."),
});

export const MeStatsSummaryQuerySchema = z.object({
  startDate: z.string().optional().describe("Start date in YYYY-MM-DD."),
  endDate: z.string().optional().describe("End date in YYYY-MM-DD."),
});

export const MeIpGeoParamSchema = z.object({
  ip: z.string().min(1).describe("IP address."),
});

export const MeIpGeoQuerySchema = z.object({
  lang: z.string().optional().describe("Preferred response language."),
});

export const GenericMeResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Current caller API response object.");

export const StringListResponseSchema = z.object({
  items: z.array(z.string()).describe("String values."),
});

export type MeUsageLogsQueryInput = z.infer<typeof MeUsageLogsQuerySchema>;
export type MeUsageLogsActionQueryInput = Omit<
  MeUsageLogsQueryInput,
  "cursorCreatedAt" | "cursorId"
> & {
  cursor?: { createdAt: string; id: number };
};
