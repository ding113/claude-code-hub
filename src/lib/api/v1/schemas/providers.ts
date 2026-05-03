import { z } from "@hono/zod-openapi";
import { HIDDEN_PROVIDER_TYPES as HIDDEN_PROVIDER_TYPE_VALUES } from "@/lib/api/v1/_shared/constants";
import { ProviderTypeSchema } from "./_common";

export const HIDDEN_PROVIDER_TYPES = new Set(HIDDEN_PROVIDER_TYPE_VALUES);

const NullableStringSchema = z.string().nullable();

export const ProviderListQuerySchema = z.object({
  q: z.string().trim().optional().describe("Case-insensitive provider search text."),
  providerType: ProviderTypeSchema.optional().describe("Filter by supported provider type."),
  include: z
    .enum(["statistics"])
    .optional()
    .describe("Optional response expansion. Supported value: statistics."),
});

export const ProviderIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Provider id."),
});

export const ProviderSummarySchema = z
  .object({
    id: z.number().int().positive().describe("Provider id."),
    name: z.string().describe("Provider display name."),
    url: z.string().url().describe("Provider upstream base URL."),
    maskedKey: z.string().describe("Masked provider API key."),
    isEnabled: z.boolean().describe("Whether the provider is enabled."),
    weight: z.number().describe("Provider routing weight."),
    priority: z.number().int().describe("Provider routing priority."),
    groupPriorities: z.record(z.string(), z.number()).nullable().describe("Per-group priorities."),
    costMultiplier: z.number().describe("Provider cost multiplier."),
    groupTag: NullableStringSchema.describe("Provider group tag."),
    providerType: ProviderTypeSchema,
    providerVendorId: z.number().int().nullable().describe("Provider vendor id."),
    preserveClientIp: z.boolean().describe("Whether client IP is preserved upstream."),
    disableSessionReuse: z.boolean().describe("Whether sticky session reuse is disabled."),
    modelRedirects: z.array(z.unknown()).nullable().describe("Model redirect rules."),
    activeTimeStart: NullableStringSchema.describe("Scheduled active start time in HH:mm."),
    activeTimeEnd: NullableStringSchema.describe("Scheduled active end time in HH:mm."),
    allowedModels: z.array(z.unknown()).nullable().describe("Allowed model rules."),
    allowedClients: z.array(z.string()).describe("Allowed client patterns."),
    blockedClients: z.array(z.string()).describe("Blocked client patterns."),
    mcpPassthroughType: z.string().nullable().describe("MCP passthrough type."),
    mcpPassthroughUrl: NullableStringSchema.describe("MCP passthrough URL."),
    limit5hUsd: z.number().nullable().describe("Five-hour cost limit in USD."),
    limit5hResetMode: z.string().describe("Five-hour reset mode."),
    limitDailyUsd: z.number().nullable().describe("Daily cost limit in USD."),
    dailyResetMode: z.string().describe("Daily reset mode."),
    dailyResetTime: z.string().describe("Daily reset time."),
    limitWeeklyUsd: z.number().nullable().describe("Weekly cost limit in USD."),
    limitMonthlyUsd: z.number().nullable().describe("Monthly cost limit in USD."),
    limitTotalUsd: z.number().nullable().describe("Total cost limit in USD."),
    totalCostResetAt: NullableStringSchema.describe("Total cost reset timestamp."),
    limitConcurrentSessions: z.number().int().describe("Concurrent session limit."),
    maxRetryAttempts: z.number().int().nullable().describe("Max retry attempts."),
    circuitBreakerFailureThreshold: z
      .number()
      .int()
      .nullable()
      .describe("Circuit breaker failure threshold."),
    circuitBreakerOpenDuration: z
      .number()
      .int()
      .nullable()
      .describe("Circuit breaker open duration in milliseconds."),
    circuitBreakerHalfOpenSuccessThreshold: z
      .number()
      .int()
      .nullable()
      .describe("Circuit breaker half-open success threshold."),
    proxyUrl: NullableStringSchema.describe(
      "Optional outbound proxy URL with credentials redacted."
    ),
    proxyFallbackToDirect: z
      .boolean()
      .describe("Whether proxy failures fall back to direct calls."),
    customHeaders: z
      .record(z.string(), z.string())
      .nullable()
      .describe("Custom upstream headers with sensitive values redacted."),
    firstByteTimeoutStreamingMs: z
      .number()
      .int()
      .nullable()
      .describe("Streaming first byte timeout in milliseconds."),
    streamingIdleTimeoutMs: z
      .number()
      .int()
      .nullable()
      .describe("Streaming idle timeout in milliseconds."),
    requestTimeoutNonStreamingMs: z
      .number()
      .int()
      .nullable()
      .describe("Non-streaming request timeout in milliseconds."),
    websiteUrl: NullableStringSchema.describe("Provider website URL."),
    faviconUrl: NullableStringSchema.describe("Provider favicon URL."),
    cacheTtlPreference: z.string().nullable().describe("Cache TTL preference."),
    swapCacheTtlBilling: z.boolean().describe("Whether cache TTL billing swap is enabled."),
    context1mPreference: z.string().nullable().describe("1M context preference."),
    codexReasoningEffortPreference: z.string().nullable().describe("Codex reasoning effort."),
    codexReasoningSummaryPreference: z.string().nullable().describe("Codex reasoning summary."),
    codexTextVerbosityPreference: z.string().nullable().describe("Codex text verbosity."),
    codexParallelToolCallsPreference: z
      .string()
      .nullable()
      .describe("Codex parallel tool calls preference."),
    codexServiceTierPreference: z.string().nullable().describe("Codex service tier preference."),
    anthropicMaxTokensPreference: z
      .string()
      .nullable()
      .describe("Anthropic max tokens preference."),
    anthropicThinkingBudgetPreference: z
      .string()
      .nullable()
      .describe("Anthropic thinking budget preference."),
    anthropicAdaptiveThinking: z
      .unknown()
      .nullable()
      .describe("Anthropic adaptive thinking config."),
    geminiGoogleSearchPreference: z
      .string()
      .nullable()
      .describe("Gemini Google Search preference."),
    todayTotalCostUsd: z.string().optional().describe("Optional today's total cost in USD."),
    todayCallCount: z.number().int().optional().describe("Optional today's call count."),
    lastCallTime: NullableStringSchema.optional().describe("Optional last call time."),
    lastCallModel: NullableStringSchema.optional().describe("Optional last call model."),
    statistics: z
      .object({
        todayCost: z.string().describe("Today's total cost in USD."),
        todayCalls: z.number().int().describe("Today's call count."),
        lastCallTime: NullableStringSchema.describe("Last call timestamp."),
        lastCallModel: NullableStringSchema.describe("Last call model name."),
      })
      .optional()
      .describe("Today statistics. Present only when include=statistics is requested."),
    createdAt: z.string().describe("Provider creation date string."),
    updatedAt: z.string().describe("Provider update date string."),
  })
  .describe(
    "Provider response. Hidden legacy provider types and deprecated limit fields are omitted."
  );

export const ProviderListResponseSchema = z.object({
  items: z.array(ProviderSummarySchema).describe("Visible providers matching the query."),
});

export const ProviderKeyRevealResponseSchema = z.object({
  key: z.string().describe("Unmasked provider API key. Returned only to admin callers."),
});

export const ProviderGenericResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Provider action response object.");

export const ProviderArrayResponseSchema = z.object({
  items: z.array(z.unknown()).describe("Provider response items."),
});

export const ProviderConfirmBodySchema = z
  .object({
    confirm: z
      .boolean()
      .default(false)
      .describe("Whether to apply the operation instead of previewing it."),
  })
  .strict();

export const ProviderIdsBodySchema = z
  .object({
    providerIds: z.array(z.number().int().positive()).min(1).max(500).describe("Provider ids."),
  })
  .strict();

const ProviderBatchUpdateFieldsSchema = z
  .object({
    is_enabled: z.boolean().optional().describe("Provider enabled state."),
    priority: z.number().int().optional().describe("Provider routing priority."),
    weight: z.number().min(0).optional().describe("Provider routing weight."),
    cost_multiplier: z.number().min(0).optional().describe("Provider cost multiplier."),
    group_tag: z.string().max(200).nullable().optional().describe("Provider group tag."),
    model_redirects: z.array(z.unknown()).nullable().optional().describe("Model redirect rules."),
    allowed_models: z.array(z.unknown()).nullable().optional().describe("Allowed model rules."),
    allowed_clients: z.array(z.string()).optional().describe("Allowed client patterns."),
    blocked_clients: z.array(z.string()).optional().describe("Blocked client patterns."),
    limit_5h_usd: z.number().min(0).nullable().optional().describe("Five-hour USD limit."),
    limit_5h_reset_mode: z.enum(["fixed", "rolling"]).optional().describe("Five-hour reset mode."),
    limit_daily_usd: z.number().min(0).nullable().optional().describe("Daily USD limit."),
    daily_reset_mode: z.enum(["fixed", "rolling"]).optional().describe("Daily reset mode."),
    daily_reset_time: z.string().optional().describe("Daily reset time."),
    codex_service_tier_preference: z
      .string()
      .nullable()
      .optional()
      .describe("Codex service tier preference."),
    anthropic_thinking_budget_preference: z
      .string()
      .nullable()
      .optional()
      .describe("Anthropic thinking budget preference."),
    anthropic_adaptive_thinking: z
      .unknown()
      .nullable()
      .optional()
      .describe("Anthropic adaptive thinking config."),
  })
  .strict();

export const ProviderBatchUpdateSchema = z
  .object({
    providerIds: z.array(z.number().int().positive()).min(1).max(500).describe("Provider ids."),
    updates: ProviderBatchUpdateFieldsSchema.describe("Provider update patch."),
  })
  .strict();

export const ProviderUndoBodySchema = z
  .object({
    undoToken: z.string().trim().min(1).describe("Undo token from the original operation."),
    operationId: z.string().trim().min(1).describe("Operation id from the original operation."),
  })
  .strict();

export const ProviderBatchPatchPreviewSchema = z
  .object({
    providerIds: z.array(z.number().int().positive()).min(1).max(500).describe("Provider ids."),
    patch: z.record(z.string(), z.unknown()).default({}).describe("Batch patch draft."),
  })
  .strict();

export const ProviderBatchPatchApplySchema = z
  .object({
    previewToken: z.string().trim().min(1).describe("Preview token."),
    previewRevision: z.string().trim().min(1).describe("Preview revision."),
    providerIds: z.array(z.number().int().positive()).min(1).max(500).describe("Provider ids."),
    patch: z.record(z.string(), z.unknown()).default({}).describe("Batch patch draft."),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe("Optional idempotency key."),
    excludeProviderIds: z
      .array(z.number().int().positive())
      .optional()
      .describe("Optional provider ids to exclude when applying."),
  })
  .strict();

export const ProviderProxyTestSchema = z
  .object({
    providerUrl: z.string().trim().url().describe("Provider base URL."),
    proxyUrl: z.string().trim().nullable().optional().describe("Optional proxy URL."),
    proxyFallbackToDirect: z
      .boolean()
      .optional()
      .describe("Whether proxy failure can fall back to direct."),
  })
  .strict();

export const ProviderApiTestSchema = z
  .object({
    providerUrl: z.string().trim().url().describe("Provider base URL."),
    apiKey: z.string().min(1).describe("Provider API key."),
    model: z.string().trim().optional().describe("Optional model override."),
    proxyUrl: z.string().trim().nullable().optional().describe("Optional proxy URL."),
    proxyFallbackToDirect: z
      .boolean()
      .optional()
      .describe("Whether proxy failure can fall back to direct."),
    timeoutMs: z
      .number()
      .int()
      .min(5000)
      .max(120000)
      .optional()
      .describe("Request timeout in milliseconds."),
  })
  .strict();

export const ProviderUnifiedTestSchema = ProviderApiTestSchema.extend({
  providerType: ProviderTypeSchema.describe("Provider type to test."),
  latencyThresholdMs: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Latency threshold in milliseconds."),
  successContains: z.string().optional().describe("Expected response content."),
  preset: z.string().optional().describe("Optional preset id."),
  customPayload: z.string().optional().describe("Optional custom JSON payload."),
  customHeaders: z.record(z.string(), z.string()).optional().describe("Optional custom headers."),
}).strict();

export const ProviderTypeQuerySchema = z.object({
  providerType: ProviderTypeSchema.describe("Provider type."),
});

export const ProviderFetchUpstreamModelsSchema = ProviderApiTestSchema.extend({
  providerType: ProviderTypeSchema.describe("Provider type."),
}).strict();

export const ProviderModelSuggestionsQuerySchema = z.object({
  providerGroup: z.string().nullable().optional().describe("Provider group tag."),
});

export const ProviderGroupsQuerySchema = z.object({
  include: z
    .enum(["count"])
    .optional()
    .describe("Optional response expansion. Supported value: count."),
  userId: z.coerce.number().int().positive().optional().describe("Optional user id filter."),
});

const TimeOfDaySchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  .describe("Time of day in HH:mm format.");

export const ProviderCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).describe("Provider display name."),
    url: z.string().trim().url().max(255).describe("Provider upstream base URL."),
    key: z.string().min(1).max(1024).describe("Provider API key. Write-only."),
    is_enabled: z.boolean().optional().describe("Whether the provider is enabled."),
    weight: z.number().int().min(1).max(100).optional().describe("Provider routing weight."),
    priority: z.number().int().min(0).optional().describe("Provider routing priority."),
    cost_multiplier: z.number().min(0).optional().describe("Provider cost multiplier."),
    group_tag: z.string().max(255).nullable().optional().describe("Provider group tag."),
    group_priorities: z
      .record(z.string(), z.number().int().min(0))
      .nullable()
      .optional()
      .describe("Per-group priority overrides."),
    provider_type: ProviderTypeSchema.optional().default("claude"),
    preserve_client_ip: z.boolean().optional().describe("Whether client IP is preserved upstream."),
    disable_session_reuse: z
      .boolean()
      .optional()
      .describe("Whether sticky session reuse is disabled."),
    model_redirects: z.array(z.unknown()).nullable().optional().describe("Model redirect rules."),
    active_time_start: TimeOfDaySchema.nullable()
      .optional()
      .describe("Scheduled active start time."),
    active_time_end: TimeOfDaySchema.nullable().optional().describe("Scheduled active end time."),
    allowed_models: z.array(z.unknown()).nullable().optional().describe("Allowed model rules."),
    allowed_clients: z.array(z.string().min(1)).optional().describe("Allowed client patterns."),
    blocked_clients: z.array(z.string().min(1)).optional().describe("Blocked client patterns."),
    mcp_passthrough_type: z
      .enum(["none", "minimax", "glm", "custom"])
      .optional()
      .describe("MCP passthrough type."),
    mcp_passthrough_url: z
      .string()
      .url()
      .max(512)
      .nullable()
      .optional()
      .describe("MCP passthrough URL."),
    limit_5h_usd: z.number().min(0).nullable().optional().describe("Five-hour cost limit in USD."),
    limit_5h_reset_mode: z.enum(["fixed", "rolling"]).optional().describe("Five-hour reset mode."),
    limit_daily_usd: z.number().min(0).nullable().optional().describe("Daily cost limit in USD."),
    daily_reset_mode: z.enum(["fixed", "rolling"]).optional().describe("Daily reset mode."),
    daily_reset_time: TimeOfDaySchema.optional().describe("Daily reset time."),
    limit_weekly_usd: z.number().min(0).nullable().optional().describe("Weekly cost limit in USD."),
    limit_monthly_usd: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe("Monthly cost limit in USD."),
    limit_total_usd: z.number().min(0).nullable().optional().describe("Total cost limit in USD."),
    limit_concurrent_sessions: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Concurrent session limit."),
    max_retry_attempts: z
      .number()
      .int()
      .min(1)
      .max(10)
      .nullable()
      .optional()
      .describe("Max retry attempts."),
    circuit_breaker_failure_threshold: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Circuit breaker failure threshold."),
    circuit_breaker_open_duration: z
      .number()
      .int()
      .min(1000)
      .max(86_400_000)
      .optional()
      .describe("Circuit breaker open duration in milliseconds."),
    circuit_breaker_half_open_success_threshold: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Circuit breaker half-open success threshold."),
    proxy_url: z.string().max(512).nullable().optional().describe("Optional outbound proxy URL."),
    proxy_fallback_to_direct: z
      .boolean()
      .optional()
      .describe("Whether proxy failures fall back to direct calls."),
    custom_headers: z
      .record(z.string(), z.string())
      .nullable()
      .optional()
      .describe("Custom upstream headers."),
    first_byte_timeout_streaming_ms: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Streaming first byte timeout in milliseconds."),
    streaming_idle_timeout_ms: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Streaming idle timeout in milliseconds."),
    request_timeout_non_streaming_ms: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Non-streaming request timeout in milliseconds."),
    website_url: z.string().url().max(512).nullable().optional().describe("Provider website URL."),
    favicon_url: z.string().max(512).nullable().optional().describe("Provider favicon URL."),
    cache_ttl_preference: z.string().optional().describe("Cache TTL preference."),
    swap_cache_ttl_billing: z
      .boolean()
      .optional()
      .describe("Whether cache TTL billing swap is enabled."),
    context_1m_preference: z.string().nullable().optional().describe("1M context preference."),
    codex_reasoning_effort_preference: z.string().optional().describe("Codex reasoning effort."),
    codex_reasoning_summary_preference: z.string().optional().describe("Codex reasoning summary."),
    codex_text_verbosity_preference: z.string().optional().describe("Codex text verbosity."),
    codex_parallel_tool_calls_preference: z
      .string()
      .optional()
      .describe("Codex parallel tool calls preference."),
    codex_service_tier_preference: z.string().optional().describe("Codex service tier preference."),
    anthropic_max_tokens_preference: z
      .string()
      .optional()
      .describe("Anthropic max tokens preference."),
    anthropic_thinking_budget_preference: z
      .string()
      .optional()
      .describe("Anthropic thinking budget preference."),
    anthropic_adaptive_thinking: z
      .unknown()
      .nullable()
      .optional()
      .describe("Anthropic adaptive thinking config."),
    gemini_google_search_preference: z
      .string()
      .optional()
      .describe("Gemini Google Search preference."),
  })
  .strict()
  .describe("Provider create request. Hidden provider types and deprecated fields are rejected.");

export const ProviderUpdateSchema = ProviderCreateSchema.omit({ key: true })
  .extend({
    key: z.string().min(1).max(1024).optional().describe("Provider API key. Write-only."),
    provider_type: ProviderTypeSchema.optional(),
  })
  .partial()
  .strict()
  .describe("Provider update request. Hidden provider types and deprecated fields are rejected.");

export type ProviderSummaryResponse = z.infer<typeof ProviderSummarySchema>;
export type ProviderListQuery = z.infer<typeof ProviderListQuerySchema>;
export type ProviderCreateInput = z.infer<typeof ProviderCreateSchema>;
export type ProviderUpdateInput = z.infer<typeof ProviderUpdateSchema>;
export type ProviderConfirmBodyInput = z.infer<typeof ProviderConfirmBodySchema>;
export type ProviderIdsBodyInput = z.infer<typeof ProviderIdsBodySchema>;
export type ProviderBatchUpdateInput = z.infer<typeof ProviderBatchUpdateSchema>;
export type ProviderUndoBodyInput = z.infer<typeof ProviderUndoBodySchema>;
export type ProviderProxyTestInput = z.infer<typeof ProviderProxyTestSchema>;
export type ProviderApiTestInput = z.infer<typeof ProviderApiTestSchema>;
export type ProviderUnifiedTestInput = z.infer<typeof ProviderUnifiedTestSchema>;
export type ProviderFetchUpstreamModelsInput = z.infer<typeof ProviderFetchUpstreamModelsSchema>;
