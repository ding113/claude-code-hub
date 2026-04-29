import { z } from "@hono/zod-openapi";
import { CURRENCY_CONFIG } from "@/lib/utils/currency";
import { IsoDateTimeStringSchema } from "./_common";

const currencyValues = Object.keys(CURRENCY_CONFIG) as [
  keyof typeof CURRENCY_CONFIG,
  ...Array<keyof typeof CURRENCY_CONFIG>,
];

const CurrencyCodeSchema = z.enum(currencyValues).describe("Currency code used for cost display.");

const BillingModelSourceSchema = z
  .enum(["original", "redirected"])
  .describe("Whether billing uses the originally requested model or the redirected model.");

const CodexPriorityBillingSourceSchema = z
  .enum(["requested", "actual"])
  .describe("Billing source used when Codex priority service tier is requested.");

const TimeZoneSchema = z
  .string()
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA timezone identifier." }
  )
  .describe("IANA timezone identifier.");

const XffPickSchema = z
  .union([
    z.literal("leftmost"),
    z.literal("rightmost"),
    z.object({
      kind: z.literal("index").describe("Select an x-forwarded-for entry by index."),
      index: z.number().int().min(0).describe("Zero-based x-forwarded-for entry index."),
    }),
  ])
  .describe("How to pick a value from an x-forwarded-for style header.");

const IpExtractionConfigSchema = z
  .object({
    headers: z
      .array(
        z.object({
          name: z.string().min(1).describe("Trusted request header name."),
          pick: XffPickSchema.optional().describe("Optional x-forwarded-for pick strategy."),
        })
      )
      .describe("Ordered trusted IP extraction headers."),
  })
  .describe("Client IP extraction configuration.");

const FakeStreamingWhitelistEntrySchema = z
  .object({
    model: z.string().min(1).max(200).describe("Exact model id eligible for fake streaming."),
    groupTags: z
      .array(z.string().min(1))
      .describe("Provider group tags. Empty means all provider groups."),
  })
  .describe("Fake streaming whitelist entry.");

const ResponseFixerConfigSchema = z
  .object({
    fixTruncatedJson: z.boolean().describe("Whether truncated JSON repair is enabled."),
    fixSseFormat: z.boolean().describe("Whether SSE format repair is enabled."),
    fixEncoding: z.boolean().describe("Whether encoding repair is enabled."),
    maxJsonDepth: z.number().int().min(1).max(2000).describe("Maximum JSON depth to repair."),
    maxFixSize: z
      .number()
      .int()
      .min(1024)
      .max(10 * 1024 * 1024)
      .describe("Maximum response size eligible for repair."),
  })
  .describe("Response fixer configuration.");

export const SystemSettingsSchema = z
  .object({
    id: z.number().int().nonnegative().describe("System settings row id."),
    siteTitle: z.string().describe("Site title shown in the dashboard."),
    allowGlobalUsageView: z.boolean().describe("Whether users can view global usage data."),
    currencyDisplay: CurrencyCodeSchema,
    billingModelSource: BillingModelSourceSchema,
    codexPriorityBillingSource: CodexPriorityBillingSourceSchema,
    timezone: TimeZoneSchema.nullable().describe(
      "Configured system timezone, or null for default."
    ),
    enableAutoCleanup: z.boolean().optional().describe("Whether usage-log cleanup is enabled."),
    cleanupRetentionDays: z.number().int().optional().describe("Usage-log retention in days."),
    cleanupSchedule: z.string().optional().describe("Cleanup cron schedule."),
    cleanupBatchSize: z.number().int().optional().describe("Cleanup batch size."),
    enableClientVersionCheck: z.boolean().describe("Whether client version checks are enabled."),
    verboseProviderError: z
      .boolean()
      .describe("Whether provider errors include extra diagnostics."),
    passThroughUpstreamErrorMessage: z
      .boolean()
      .describe("Whether sanitized upstream error messages are passed through."),
    enableHttp2: z.boolean().describe("Whether upstream HTTP/2 connections are enabled."),
    enableOpenaiResponsesWebsocket: z
      .boolean()
      .describe("Whether OpenAI Responses websocket upstream mode is enabled."),
    enableHighConcurrencyMode: z.boolean().describe("Whether high-concurrency mode is enabled."),
    interceptAnthropicWarmupRequests: z
      .boolean()
      .describe("Whether Anthropic warmup requests are intercepted."),
    enableThinkingSignatureRectifier: z
      .boolean()
      .describe("Whether thinking signature rectifier retries are enabled."),
    enableThinkingBudgetRectifier: z
      .boolean()
      .describe("Whether thinking budget rectifier retries are enabled."),
    enableBillingHeaderRectifier: z
      .boolean()
      .describe("Whether billing-header rectifier is enabled."),
    enableResponseInputRectifier: z
      .boolean()
      .describe("Whether Responses API input rectifier is enabled."),
    allowNonConversationEndpointProviderFallback: z
      .boolean()
      .describe("Whether non-conversation endpoints may fall back across providers."),
    fakeStreamingWhitelist: z
      .array(FakeStreamingWhitelistEntrySchema)
      .describe("Fake streaming model whitelist."),
    enableCodexSessionIdCompletion: z
      .boolean()
      .describe("Whether Codex session id completion is enabled."),
    enableClaudeMetadataUserIdInjection: z
      .boolean()
      .describe("Whether Claude metadata.user_id injection is enabled."),
    enableResponseFixer: z.boolean().describe("Whether response fixer is enabled."),
    responseFixerConfig: ResponseFixerConfigSchema,
    quotaDbRefreshIntervalSeconds: z
      .number()
      .int()
      .optional()
      .describe("Quota DB refresh interval in seconds."),
    quotaLeasePercent5h: z.number().optional().describe("Five-hour quota lease percent."),
    quotaLeasePercentDaily: z.number().optional().describe("Daily quota lease percent."),
    quotaLeasePercentWeekly: z.number().optional().describe("Weekly quota lease percent."),
    quotaLeasePercentMonthly: z.number().optional().describe("Monthly quota lease percent."),
    quotaLeaseCapUsd: z.number().nullable().optional().describe("Optional quota lease cap in USD."),
    ipExtractionConfig: IpExtractionConfigSchema.nullable().describe(
      "Client IP extraction config."
    ),
    ipGeoLookupEnabled: z.boolean().describe("Whether IP geolocation lookup is enabled."),
    publicStatusWindowHours: z.number().int().describe("Public status aggregation range in hours."),
    publicStatusAggregationIntervalMinutes: z
      .number()
      .int()
      .describe("Public status aggregation interval in minutes."),
    createdAt: IsoDateTimeStringSchema.describe("Creation time."),
    updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
  })
  .describe("System settings response.");

export const SystemSettingsUpdateSchema = SystemSettingsSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    timezone: TimeZoneSchema.nullable()
      .optional()
      .describe("System timezone, or null to use default."),
    responseFixerConfig: ResponseFixerConfigSchema.partial().optional(),
  })
  .partial()
  .strict()
  .describe("System settings partial update request.");

export const SystemSettingsUpdateResponseSchema = SystemSettingsSchema.extend({
  publicStatusProjectionWarningCode: z
    .string()
    .nullable()
    .optional()
    .describe("Optional public-status projection warning code."),
});

export const SystemDisplaySettingsSchema = z.object({
  siteTitle: z.string().describe("Site title shown in read-only dashboard surfaces."),
  currencyDisplay: CurrencyCodeSchema,
  billingModelSource: BillingModelSourceSchema,
});

export const SystemTimezoneResponseSchema = z.object({
  timeZone: z.string().describe("Resolved server timezone."),
});

export type SystemSettingsResponse = z.infer<typeof SystemSettingsSchema>;
export type SystemSettingsUpdateInput = z.infer<typeof SystemSettingsUpdateSchema>;
export type SystemDisplaySettingsResponse = z.infer<typeof SystemDisplaySettingsSchema>;
export type SystemTimezoneResponse = z.infer<typeof SystemTimezoneResponseSchema>;
