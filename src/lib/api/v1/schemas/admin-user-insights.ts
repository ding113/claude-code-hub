import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const AdminUserInsightIdParamSchema = z.object({
  userId: z.coerce.number().int().positive().describe("Target user id."),
});

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar date in YYYY-MM-DD format.");

export const AdminUserInsightDateQuerySchema = z.object({
  startDate: DateOnlySchema.optional().describe("Inclusive start date."),
  endDate: DateOnlySchema.optional().describe("Inclusive end date."),
});

export const AdminUserInsightKeyTrendQuerySchema = z.object({
  timeRange: z
    .enum(["today", "7days", "30days", "thisMonth"])
    .default("today")
    .describe("Statistics time range."),
});

export const AdminUserInsightModelBreakdownQuerySchema = AdminUserInsightDateQuerySchema.extend({
  keyId: z.coerce.number().int().positive().optional().describe("Optional key id filter."),
  providerId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional provider id filter."),
});

export const AdminUserInsightProviderBreakdownQuerySchema = AdminUserInsightDateQuerySchema.extend({
  keyId: z.coerce.number().int().positive().optional().describe("Optional key id filter."),
  model: z.string().trim().min(1).optional().describe("Optional model name filter."),
});

export const AdminUserInsightUserSchema = z.object({
  id: z.number().int().positive().describe("User id."),
  name: z.string().describe("User display name."),
  description: z.string().nullable().optional().describe("User description."),
  role: z.enum(["admin", "user"]).describe("User role."),
  providerGroup: z.string().nullable().optional().describe("Assigned provider group."),
  tags: z.array(z.string()).optional().describe("User tags."),
  isEnabled: z.boolean().optional().describe("Whether the user is enabled."),
  createdAt: IsoDateTimeStringSchema.optional().describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.optional().describe("Last update time."),
});

export const UserInsightsOverviewMetricsSchema = z.object({
  requestCount: z.number().int().min(0).describe("Request count."),
  totalCost: z.number().min(0).describe("Total cost."),
  avgResponseTime: z.number().min(0).describe("Average response time in milliseconds."),
  errorRate: z.number().min(0).describe("Error rate percentage."),
});

export const AdminUserInsightsOverviewResponseSchema = z.object({
  user: AdminUserInsightUserSchema.describe("Target user."),
  overview: UserInsightsOverviewMetricsSchema.describe("Overview metrics."),
  currencyCode: z.string().describe("Currency code used to display cost values."),
});

export const AdminUserInsightsKeyTrendRowSchema = z.object({
  key_id: z.number().int().describe("Key id."),
  key_name: z.string().describe("Key display name."),
  date: z.string().describe("Statistics bucket date."),
  api_calls: z.number().int().min(0).describe("API call count."),
  total_cost: z.union([z.string(), z.number(), z.null()]).describe("Total cost."),
});

const TokenBreakdownBaseSchema = z.object({
  requests: z.number().int().min(0).describe("Request count."),
  cost: z.number().min(0).describe("Cost."),
  inputTokens: z.number().min(0).describe("Input tokens."),
  outputTokens: z.number().min(0).describe("Output tokens."),
  cacheCreationTokens: z.number().min(0).describe("Cache creation input tokens."),
  cacheReadTokens: z.number().min(0).describe("Cache read input tokens."),
});

export const AdminUserModelBreakdownItemSchema = TokenBreakdownBaseSchema.extend({
  model: z.string().nullable().describe("Model name."),
});

export const AdminUserProviderBreakdownItemSchema = TokenBreakdownBaseSchema.extend({
  providerId: z.number().int().positive().describe("Provider id."),
  providerName: z.string().nullable().describe("Provider display name."),
});

export const AdminUserModelBreakdownResponseSchema = z.object({
  breakdown: z.array(AdminUserModelBreakdownItemSchema).describe("Model breakdown items."),
  currencyCode: z.string().describe("Currency code used to display cost values."),
});

export const AdminUserProviderBreakdownResponseSchema = z.object({
  breakdown: z.array(AdminUserProviderBreakdownItemSchema).describe("Provider breakdown items."),
  currencyCode: z.string().describe("Currency code used to display cost values."),
});

export type AdminUserInsightDateQuery = z.infer<typeof AdminUserInsightDateQuerySchema>;
export type AdminUserInsightKeyTrendQuery = z.infer<typeof AdminUserInsightKeyTrendQuerySchema>;
export type AdminUserInsightModelBreakdownQuery = z.infer<
  typeof AdminUserInsightModelBreakdownQuerySchema
>;
export type AdminUserInsightProviderBreakdownQuery = z.infer<
  typeof AdminUserInsightProviderBreakdownQuerySchema
>;
