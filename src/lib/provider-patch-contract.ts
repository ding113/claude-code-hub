import type {
  ProviderBatchApplyUpdates,
  ProviderBatchPatch,
  ProviderBatchPatchDraft,
  ProviderBatchPatchField,
  ProviderPatchDraftInput,
  ProviderPatchOperation,
} from "@/types/provider";

export const PROVIDER_PATCH_ERROR_CODES = {
  INVALID_PATCH_SHAPE: "INVALID_PATCH_SHAPE",
} as const;

export type ProviderPatchErrorCode =
  (typeof PROVIDER_PATCH_ERROR_CODES)[keyof typeof PROVIDER_PATCH_ERROR_CODES];

interface ProviderPatchError {
  code: ProviderPatchErrorCode;
  field: ProviderBatchPatchField | "__root__";
  message: string;
}

type ProviderPatchResult<T> = { ok: true; data: T } | { ok: false; error: ProviderPatchError };

const PATCH_INPUT_KEYS = new Set(["set", "clear", "no_change"]);
const PATCH_FIELDS: ProviderBatchPatchField[] = [
  "is_enabled",
  "priority",
  "weight",
  "cost_multiplier",
  "group_tag",
  "model_redirects",
  "allowed_models",
  "anthropic_thinking_budget_preference",
  "anthropic_adaptive_thinking",
  // Routing
  "preserve_client_ip",
  "group_priorities",
  "cache_ttl_preference",
  "swap_cache_ttl_billing",
  "context_1m_preference",
  "codex_reasoning_effort_preference",
  "codex_reasoning_summary_preference",
  "codex_text_verbosity_preference",
  "codex_parallel_tool_calls_preference",
  "anthropic_max_tokens_preference",
  "gemini_google_search_preference",
  // Rate Limit
  "limit_5h_usd",
  "limit_daily_usd",
  "daily_reset_mode",
  "daily_reset_time",
  "limit_weekly_usd",
  "limit_monthly_usd",
  "limit_total_usd",
  "limit_concurrent_sessions",
  // Circuit Breaker
  "circuit_breaker_failure_threshold",
  "circuit_breaker_open_duration",
  "circuit_breaker_half_open_success_threshold",
  "max_retry_attempts",
  // Network
  "proxy_url",
  "proxy_fallback_to_direct",
  "first_byte_timeout_streaming_ms",
  "streaming_idle_timeout_ms",
  "request_timeout_non_streaming_ms",
  // MCP
  "mcp_passthrough_type",
  "mcp_passthrough_url",
];
const PATCH_FIELD_SET = new Set(PATCH_FIELDS);

const CLEARABLE_FIELDS: Record<ProviderBatchPatchField, boolean> = {
  is_enabled: false,
  priority: false,
  weight: false,
  cost_multiplier: false,
  group_tag: true,
  model_redirects: true,
  allowed_models: true,
  anthropic_thinking_budget_preference: true,
  anthropic_adaptive_thinking: true,
  // Routing
  preserve_client_ip: false,
  group_priorities: true,
  cache_ttl_preference: true,
  swap_cache_ttl_billing: false,
  context_1m_preference: true,
  codex_reasoning_effort_preference: true,
  codex_reasoning_summary_preference: true,
  codex_text_verbosity_preference: true,
  codex_parallel_tool_calls_preference: true,
  anthropic_max_tokens_preference: true,
  gemini_google_search_preference: true,
  // Rate Limit
  limit_5h_usd: true,
  limit_daily_usd: true,
  daily_reset_mode: false,
  daily_reset_time: false,
  limit_weekly_usd: true,
  limit_monthly_usd: true,
  limit_total_usd: true,
  limit_concurrent_sessions: false,
  // Circuit Breaker
  circuit_breaker_failure_threshold: false,
  circuit_breaker_open_duration: false,
  circuit_breaker_half_open_success_threshold: false,
  max_retry_attempts: true,
  // Network
  proxy_url: true,
  proxy_fallback_to_direct: false,
  first_byte_timeout_streaming_ms: false,
  streaming_idle_timeout_ms: false,
  request_timeout_non_streaming_ms: false,
  // MCP
  mcp_passthrough_type: false,
  mcp_passthrough_url: true,
};

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, entry]) => typeof key === "string" && typeof entry === "string"
  );
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v));
}

function isAdaptiveThinkingConfig(
  value: unknown
): value is NonNullable<ProviderBatchApplyUpdates["anthropic_adaptive_thinking"]> {
  if (!isRecord(value)) {
    return false;
  }

  const effortValues = new Set(["low", "medium", "high", "max"]);
  const modeValues = new Set(["specific", "all"]);

  if (typeof value.effort !== "string" || !effortValues.has(value.effort)) {
    return false;
  }

  if (typeof value.modelMatchMode !== "string" || !modeValues.has(value.modelMatchMode)) {
    return false;
  }

  if (!Array.isArray(value.models) || !value.models.every((model) => typeof model === "string")) {
    return false;
  }

  if (value.modelMatchMode === "specific" && value.models.length === 0) {
    return false;
  }

  return true;
}

function isThinkingBudgetPreference(value: unknown): boolean {
  if (value === "inherit") {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed >= 1024 && parsed <= 32000;
}

function isMaxTokensPreference(value: unknown): boolean {
  if (value === "inherit") {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed > 0;
}

function isValidSetValue(field: ProviderBatchPatchField, value: unknown): boolean {
  switch (field) {
    case "is_enabled":
    case "preserve_client_ip":
    case "swap_cache_ttl_billing":
    case "proxy_fallback_to_direct":
      return typeof value === "boolean";
    case "priority":
    case "weight":
    case "cost_multiplier":
    case "limit_5h_usd":
    case "limit_daily_usd":
    case "limit_weekly_usd":
    case "limit_monthly_usd":
    case "limit_total_usd":
    case "limit_concurrent_sessions":
    case "circuit_breaker_failure_threshold":
    case "circuit_breaker_open_duration":
    case "circuit_breaker_half_open_success_threshold":
    case "max_retry_attempts":
    case "first_byte_timeout_streaming_ms":
    case "streaming_idle_timeout_ms":
    case "request_timeout_non_streaming_ms":
      return typeof value === "number" && Number.isFinite(value);
    case "group_tag":
    case "daily_reset_time":
    case "proxy_url":
    case "mcp_passthrough_url":
      return typeof value === "string";
    case "group_priorities":
      return isNumberRecord(value);
    case "cache_ttl_preference":
      return value === "inherit" || value === "5m" || value === "1h";
    case "context_1m_preference":
      return value === "inherit" || value === "force_enable" || value === "disabled";
    case "daily_reset_mode":
      return value === "fixed" || value === "rolling";
    case "codex_reasoning_effort_preference":
      return (
        value === "inherit" ||
        value === "none" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh"
      );
    case "codex_reasoning_summary_preference":
      return value === "inherit" || value === "auto" || value === "detailed";
    case "codex_text_verbosity_preference":
      return value === "inherit" || value === "low" || value === "medium" || value === "high";
    case "codex_parallel_tool_calls_preference":
      return value === "inherit" || value === "true" || value === "false";
    case "anthropic_thinking_budget_preference":
      return isThinkingBudgetPreference(value);
    case "anthropic_max_tokens_preference":
      return isMaxTokensPreference(value);
    case "gemini_google_search_preference":
      return value === "inherit" || value === "enabled" || value === "disabled";
    case "mcp_passthrough_type":
      return value === "none" || value === "minimax" || value === "glm" || value === "custom";
    case "model_redirects":
      return isStringRecord(value);
    case "allowed_models":
      return Array.isArray(value) && value.every((model) => typeof model === "string");
    case "anthropic_adaptive_thinking":
      return isAdaptiveThinkingConfig(value);
    default:
      return false;
  }
}

function createNoChangePatch<T>(): ProviderPatchOperation<T> {
  return { mode: "no_change" };
}

function createInvalidPatchShapeError(
  field: ProviderBatchPatchField,
  message: string
): ProviderPatchResult<never> {
  return {
    ok: false,
    error: {
      code: PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE,
      field,
      message,
    },
  };
}

function createInvalidRootPatchShapeError(message: string): ProviderPatchResult<never> {
  return {
    ok: false,
    error: {
      code: PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE,
      field: "__root__",
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePatchField<T>(
  field: ProviderBatchPatchField,
  input: ProviderPatchDraftInput<T>
): ProviderPatchResult<ProviderPatchOperation<T>> {
  if (input === undefined) {
    return { ok: true, data: createNoChangePatch() };
  }

  if (!isRecord(input)) {
    return createInvalidPatchShapeError(field, "Patch input must be an object");
  }

  const unknownKeys = Object.keys(input).filter((key) => !PATCH_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return createInvalidPatchShapeError(
      field,
      `Patch input contains unknown keys: ${unknownKeys.join(",")}`
    );
  }

  const hasSet = Object.hasOwn(input, "set");
  const hasClear = input.clear === true;
  const hasNoChange = input.no_change === true;
  const modeCount = [hasSet, hasClear, hasNoChange].filter(Boolean).length;

  if (modeCount !== 1) {
    return createInvalidPatchShapeError(field, "Patch input must choose exactly one mode");
  }

  if (hasSet) {
    if (input.set === undefined) {
      return createInvalidPatchShapeError(field, "set mode requires a defined value");
    }

    if (!isValidSetValue(field, input.set)) {
      return createInvalidPatchShapeError(field, "set mode value is invalid for this field");
    }

    return { ok: true, data: { mode: "set", value: input.set as T } };
  }

  if (hasNoChange) {
    return { ok: true, data: createNoChangePatch() };
  }

  if (!CLEARABLE_FIELDS[field]) {
    return createInvalidPatchShapeError(field, "clear mode is not supported for this field");
  }

  return { ok: true, data: { mode: "clear" } };
}

export function normalizeProviderBatchPatchDraft(
  draft: unknown
): ProviderPatchResult<ProviderBatchPatch> {
  if (!isRecord(draft) || Array.isArray(draft)) {
    return createInvalidRootPatchShapeError("Patch draft must be an object");
  }

  const unknownFields = Object.keys(draft).filter(
    (key) => !PATCH_FIELD_SET.has(key as ProviderBatchPatchField)
  );
  if (unknownFields.length > 0) {
    return createInvalidRootPatchShapeError(
      `Patch draft contains unknown fields: ${unknownFields.join(",")}`
    );
  }

  const typedDraft = draft as ProviderBatchPatchDraft;

  const isEnabled = normalizePatchField("is_enabled", typedDraft.is_enabled);
  if (!isEnabled.ok) return isEnabled;

  const priority = normalizePatchField("priority", typedDraft.priority);
  if (!priority.ok) return priority;

  const weight = normalizePatchField("weight", typedDraft.weight);
  if (!weight.ok) return weight;

  const costMultiplier = normalizePatchField("cost_multiplier", typedDraft.cost_multiplier);
  if (!costMultiplier.ok) return costMultiplier;

  const groupTag = normalizePatchField("group_tag", typedDraft.group_tag);
  if (!groupTag.ok) return groupTag;

  const modelRedirects = normalizePatchField("model_redirects", typedDraft.model_redirects);
  if (!modelRedirects.ok) return modelRedirects;

  const allowedModels = normalizePatchField("allowed_models", typedDraft.allowed_models);
  if (!allowedModels.ok) return allowedModels;

  const thinkingBudget = normalizePatchField(
    "anthropic_thinking_budget_preference",
    typedDraft.anthropic_thinking_budget_preference
  );
  if (!thinkingBudget.ok) return thinkingBudget;

  const adaptiveThinking = normalizePatchField(
    "anthropic_adaptive_thinking",
    typedDraft.anthropic_adaptive_thinking
  );
  if (!adaptiveThinking.ok) return adaptiveThinking;

  // Routing
  const preserveClientIp = normalizePatchField("preserve_client_ip", typedDraft.preserve_client_ip);
  if (!preserveClientIp.ok) return preserveClientIp;

  const groupPriorities = normalizePatchField("group_priorities", typedDraft.group_priorities);
  if (!groupPriorities.ok) return groupPriorities;

  const cacheTtlPref = normalizePatchField("cache_ttl_preference", typedDraft.cache_ttl_preference);
  if (!cacheTtlPref.ok) return cacheTtlPref;

  const swapCacheTtlBilling = normalizePatchField(
    "swap_cache_ttl_billing",
    typedDraft.swap_cache_ttl_billing
  );
  if (!swapCacheTtlBilling.ok) return swapCacheTtlBilling;

  const context1mPref = normalizePatchField(
    "context_1m_preference",
    typedDraft.context_1m_preference
  );
  if (!context1mPref.ok) return context1mPref;

  const codexReasoningEffort = normalizePatchField(
    "codex_reasoning_effort_preference",
    typedDraft.codex_reasoning_effort_preference
  );
  if (!codexReasoningEffort.ok) return codexReasoningEffort;

  const codexReasoningSummary = normalizePatchField(
    "codex_reasoning_summary_preference",
    typedDraft.codex_reasoning_summary_preference
  );
  if (!codexReasoningSummary.ok) return codexReasoningSummary;

  const codexTextVerbosity = normalizePatchField(
    "codex_text_verbosity_preference",
    typedDraft.codex_text_verbosity_preference
  );
  if (!codexTextVerbosity.ok) return codexTextVerbosity;

  const codexParallelToolCalls = normalizePatchField(
    "codex_parallel_tool_calls_preference",
    typedDraft.codex_parallel_tool_calls_preference
  );
  if (!codexParallelToolCalls.ok) return codexParallelToolCalls;

  const anthropicMaxTokens = normalizePatchField(
    "anthropic_max_tokens_preference",
    typedDraft.anthropic_max_tokens_preference
  );
  if (!anthropicMaxTokens.ok) return anthropicMaxTokens;

  const geminiGoogleSearch = normalizePatchField(
    "gemini_google_search_preference",
    typedDraft.gemini_google_search_preference
  );
  if (!geminiGoogleSearch.ok) return geminiGoogleSearch;

  // Rate Limit
  const limit5hUsd = normalizePatchField("limit_5h_usd", typedDraft.limit_5h_usd);
  if (!limit5hUsd.ok) return limit5hUsd;

  const limitDailyUsd = normalizePatchField("limit_daily_usd", typedDraft.limit_daily_usd);
  if (!limitDailyUsd.ok) return limitDailyUsd;

  const dailyResetMode = normalizePatchField("daily_reset_mode", typedDraft.daily_reset_mode);
  if (!dailyResetMode.ok) return dailyResetMode;

  const dailyResetTime = normalizePatchField("daily_reset_time", typedDraft.daily_reset_time);
  if (!dailyResetTime.ok) return dailyResetTime;

  const limitWeeklyUsd = normalizePatchField("limit_weekly_usd", typedDraft.limit_weekly_usd);
  if (!limitWeeklyUsd.ok) return limitWeeklyUsd;

  const limitMonthlyUsd = normalizePatchField("limit_monthly_usd", typedDraft.limit_monthly_usd);
  if (!limitMonthlyUsd.ok) return limitMonthlyUsd;

  const limitTotalUsd = normalizePatchField("limit_total_usd", typedDraft.limit_total_usd);
  if (!limitTotalUsd.ok) return limitTotalUsd;

  const limitConcurrentSessions = normalizePatchField(
    "limit_concurrent_sessions",
    typedDraft.limit_concurrent_sessions
  );
  if (!limitConcurrentSessions.ok) return limitConcurrentSessions;

  // Circuit Breaker
  const cbFailureThreshold = normalizePatchField(
    "circuit_breaker_failure_threshold",
    typedDraft.circuit_breaker_failure_threshold
  );
  if (!cbFailureThreshold.ok) return cbFailureThreshold;

  const cbOpenDuration = normalizePatchField(
    "circuit_breaker_open_duration",
    typedDraft.circuit_breaker_open_duration
  );
  if (!cbOpenDuration.ok) return cbOpenDuration;

  const cbHalfOpenSuccess = normalizePatchField(
    "circuit_breaker_half_open_success_threshold",
    typedDraft.circuit_breaker_half_open_success_threshold
  );
  if (!cbHalfOpenSuccess.ok) return cbHalfOpenSuccess;

  const maxRetryAttempts = normalizePatchField("max_retry_attempts", typedDraft.max_retry_attempts);
  if (!maxRetryAttempts.ok) return maxRetryAttempts;

  // Network
  const proxyUrl = normalizePatchField("proxy_url", typedDraft.proxy_url);
  if (!proxyUrl.ok) return proxyUrl;

  const proxyFallbackToDirect = normalizePatchField(
    "proxy_fallback_to_direct",
    typedDraft.proxy_fallback_to_direct
  );
  if (!proxyFallbackToDirect.ok) return proxyFallbackToDirect;

  const firstByteTimeout = normalizePatchField(
    "first_byte_timeout_streaming_ms",
    typedDraft.first_byte_timeout_streaming_ms
  );
  if (!firstByteTimeout.ok) return firstByteTimeout;

  const streamingIdleTimeout = normalizePatchField(
    "streaming_idle_timeout_ms",
    typedDraft.streaming_idle_timeout_ms
  );
  if (!streamingIdleTimeout.ok) return streamingIdleTimeout;

  const requestTimeoutNonStreaming = normalizePatchField(
    "request_timeout_non_streaming_ms",
    typedDraft.request_timeout_non_streaming_ms
  );
  if (!requestTimeoutNonStreaming.ok) return requestTimeoutNonStreaming;

  // MCP
  const mcpPassthroughType = normalizePatchField(
    "mcp_passthrough_type",
    typedDraft.mcp_passthrough_type
  );
  if (!mcpPassthroughType.ok) return mcpPassthroughType;

  const mcpPassthroughUrl = normalizePatchField(
    "mcp_passthrough_url",
    typedDraft.mcp_passthrough_url
  );
  if (!mcpPassthroughUrl.ok) return mcpPassthroughUrl;

  return {
    ok: true,
    data: {
      is_enabled: isEnabled.data,
      priority: priority.data,
      weight: weight.data,
      cost_multiplier: costMultiplier.data,
      group_tag: groupTag.data,
      model_redirects: modelRedirects.data,
      allowed_models: allowedModels.data,
      anthropic_thinking_budget_preference: thinkingBudget.data,
      anthropic_adaptive_thinking: adaptiveThinking.data,
      // Routing
      preserve_client_ip: preserveClientIp.data,
      group_priorities: groupPriorities.data,
      cache_ttl_preference: cacheTtlPref.data,
      swap_cache_ttl_billing: swapCacheTtlBilling.data,
      context_1m_preference: context1mPref.data,
      codex_reasoning_effort_preference: codexReasoningEffort.data,
      codex_reasoning_summary_preference: codexReasoningSummary.data,
      codex_text_verbosity_preference: codexTextVerbosity.data,
      codex_parallel_tool_calls_preference: codexParallelToolCalls.data,
      anthropic_max_tokens_preference: anthropicMaxTokens.data,
      gemini_google_search_preference: geminiGoogleSearch.data,
      // Rate Limit
      limit_5h_usd: limit5hUsd.data,
      limit_daily_usd: limitDailyUsd.data,
      daily_reset_mode: dailyResetMode.data,
      daily_reset_time: dailyResetTime.data,
      limit_weekly_usd: limitWeeklyUsd.data,
      limit_monthly_usd: limitMonthlyUsd.data,
      limit_total_usd: limitTotalUsd.data,
      limit_concurrent_sessions: limitConcurrentSessions.data,
      // Circuit Breaker
      circuit_breaker_failure_threshold: cbFailureThreshold.data,
      circuit_breaker_open_duration: cbOpenDuration.data,
      circuit_breaker_half_open_success_threshold: cbHalfOpenSuccess.data,
      max_retry_attempts: maxRetryAttempts.data,
      // Network
      proxy_url: proxyUrl.data,
      proxy_fallback_to_direct: proxyFallbackToDirect.data,
      first_byte_timeout_streaming_ms: firstByteTimeout.data,
      streaming_idle_timeout_ms: streamingIdleTimeout.data,
      request_timeout_non_streaming_ms: requestTimeoutNonStreaming.data,
      // MCP
      mcp_passthrough_type: mcpPassthroughType.data,
      mcp_passthrough_url: mcpPassthroughUrl.data,
    },
  };
}

function applyPatchField<T>(
  updates: ProviderBatchApplyUpdates,
  field: ProviderBatchPatchField,
  patch: ProviderPatchOperation<T>
): ProviderPatchResult<void> {
  if (patch.mode === "no_change") {
    return { ok: true, data: undefined };
  }

  if (patch.mode === "set") {
    switch (field) {
      case "is_enabled":
        updates.is_enabled = patch.value as ProviderBatchApplyUpdates["is_enabled"];
        return { ok: true, data: undefined };
      case "priority":
        updates.priority = patch.value as ProviderBatchApplyUpdates["priority"];
        return { ok: true, data: undefined };
      case "weight":
        updates.weight = patch.value as ProviderBatchApplyUpdates["weight"];
        return { ok: true, data: undefined };
      case "cost_multiplier":
        updates.cost_multiplier = patch.value as ProviderBatchApplyUpdates["cost_multiplier"];
        return { ok: true, data: undefined };
      case "group_tag":
        updates.group_tag = patch.value as ProviderBatchApplyUpdates["group_tag"];
        return { ok: true, data: undefined };
      case "model_redirects":
        updates.model_redirects = patch.value as ProviderBatchApplyUpdates["model_redirects"];
        return { ok: true, data: undefined };
      case "allowed_models":
        updates.allowed_models =
          (patch.value as string[]).length > 0
            ? (patch.value as ProviderBatchApplyUpdates["allowed_models"])
            : null;
        return { ok: true, data: undefined };
      case "anthropic_thinking_budget_preference":
        updates.anthropic_thinking_budget_preference =
          patch.value as ProviderBatchApplyUpdates["anthropic_thinking_budget_preference"];
        return { ok: true, data: undefined };
      case "anthropic_adaptive_thinking":
        updates.anthropic_adaptive_thinking =
          patch.value as ProviderBatchApplyUpdates["anthropic_adaptive_thinking"];
        return { ok: true, data: undefined };
      // Routing
      case "preserve_client_ip":
        updates.preserve_client_ip = patch.value as ProviderBatchApplyUpdates["preserve_client_ip"];
        return { ok: true, data: undefined };
      case "group_priorities":
        updates.group_priorities = patch.value as ProviderBatchApplyUpdates["group_priorities"];
        return { ok: true, data: undefined };
      case "cache_ttl_preference":
        updates.cache_ttl_preference =
          patch.value as ProviderBatchApplyUpdates["cache_ttl_preference"];
        return { ok: true, data: undefined };
      case "swap_cache_ttl_billing":
        updates.swap_cache_ttl_billing =
          patch.value as ProviderBatchApplyUpdates["swap_cache_ttl_billing"];
        return { ok: true, data: undefined };
      case "context_1m_preference":
        updates.context_1m_preference =
          patch.value as ProviderBatchApplyUpdates["context_1m_preference"];
        return { ok: true, data: undefined };
      case "codex_reasoning_effort_preference":
        updates.codex_reasoning_effort_preference =
          patch.value as ProviderBatchApplyUpdates["codex_reasoning_effort_preference"];
        return { ok: true, data: undefined };
      case "codex_reasoning_summary_preference":
        updates.codex_reasoning_summary_preference =
          patch.value as ProviderBatchApplyUpdates["codex_reasoning_summary_preference"];
        return { ok: true, data: undefined };
      case "codex_text_verbosity_preference":
        updates.codex_text_verbosity_preference =
          patch.value as ProviderBatchApplyUpdates["codex_text_verbosity_preference"];
        return { ok: true, data: undefined };
      case "codex_parallel_tool_calls_preference":
        updates.codex_parallel_tool_calls_preference =
          patch.value as ProviderBatchApplyUpdates["codex_parallel_tool_calls_preference"];
        return { ok: true, data: undefined };
      case "anthropic_max_tokens_preference":
        updates.anthropic_max_tokens_preference =
          patch.value as ProviderBatchApplyUpdates["anthropic_max_tokens_preference"];
        return { ok: true, data: undefined };
      case "gemini_google_search_preference":
        updates.gemini_google_search_preference =
          patch.value as ProviderBatchApplyUpdates["gemini_google_search_preference"];
        return { ok: true, data: undefined };
      // Rate Limit
      case "limit_5h_usd":
        updates.limit_5h_usd = patch.value as ProviderBatchApplyUpdates["limit_5h_usd"];
        return { ok: true, data: undefined };
      case "limit_daily_usd":
        updates.limit_daily_usd = patch.value as ProviderBatchApplyUpdates["limit_daily_usd"];
        return { ok: true, data: undefined };
      case "daily_reset_mode":
        updates.daily_reset_mode = patch.value as ProviderBatchApplyUpdates["daily_reset_mode"];
        return { ok: true, data: undefined };
      case "daily_reset_time":
        updates.daily_reset_time = patch.value as ProviderBatchApplyUpdates["daily_reset_time"];
        return { ok: true, data: undefined };
      case "limit_weekly_usd":
        updates.limit_weekly_usd = patch.value as ProviderBatchApplyUpdates["limit_weekly_usd"];
        return { ok: true, data: undefined };
      case "limit_monthly_usd":
        updates.limit_monthly_usd = patch.value as ProviderBatchApplyUpdates["limit_monthly_usd"];
        return { ok: true, data: undefined };
      case "limit_total_usd":
        updates.limit_total_usd = patch.value as ProviderBatchApplyUpdates["limit_total_usd"];
        return { ok: true, data: undefined };
      case "limit_concurrent_sessions":
        updates.limit_concurrent_sessions =
          patch.value as ProviderBatchApplyUpdates["limit_concurrent_sessions"];
        return { ok: true, data: undefined };
      // Circuit Breaker
      case "circuit_breaker_failure_threshold":
        updates.circuit_breaker_failure_threshold =
          patch.value as ProviderBatchApplyUpdates["circuit_breaker_failure_threshold"];
        return { ok: true, data: undefined };
      case "circuit_breaker_open_duration":
        updates.circuit_breaker_open_duration =
          patch.value as ProviderBatchApplyUpdates["circuit_breaker_open_duration"];
        return { ok: true, data: undefined };
      case "circuit_breaker_half_open_success_threshold":
        updates.circuit_breaker_half_open_success_threshold =
          patch.value as ProviderBatchApplyUpdates["circuit_breaker_half_open_success_threshold"];
        return { ok: true, data: undefined };
      case "max_retry_attempts":
        updates.max_retry_attempts = patch.value as ProviderBatchApplyUpdates["max_retry_attempts"];
        return { ok: true, data: undefined };
      // Network
      case "proxy_url":
        updates.proxy_url = patch.value as ProviderBatchApplyUpdates["proxy_url"];
        return { ok: true, data: undefined };
      case "proxy_fallback_to_direct":
        updates.proxy_fallback_to_direct =
          patch.value as ProviderBatchApplyUpdates["proxy_fallback_to_direct"];
        return { ok: true, data: undefined };
      case "first_byte_timeout_streaming_ms":
        updates.first_byte_timeout_streaming_ms =
          patch.value as ProviderBatchApplyUpdates["first_byte_timeout_streaming_ms"];
        return { ok: true, data: undefined };
      case "streaming_idle_timeout_ms":
        updates.streaming_idle_timeout_ms =
          patch.value as ProviderBatchApplyUpdates["streaming_idle_timeout_ms"];
        return { ok: true, data: undefined };
      case "request_timeout_non_streaming_ms":
        updates.request_timeout_non_streaming_ms =
          patch.value as ProviderBatchApplyUpdates["request_timeout_non_streaming_ms"];
        return { ok: true, data: undefined };
      // MCP
      case "mcp_passthrough_type":
        updates.mcp_passthrough_type =
          patch.value as ProviderBatchApplyUpdates["mcp_passthrough_type"];
        return { ok: true, data: undefined };
      case "mcp_passthrough_url":
        updates.mcp_passthrough_url =
          patch.value as ProviderBatchApplyUpdates["mcp_passthrough_url"];
        return { ok: true, data: undefined };
      default:
        return createInvalidPatchShapeError(field, "Unsupported patch field");
    }
  }

  // clear mode
  switch (field) {
    case "group_tag":
      updates.group_tag = null;
      return { ok: true, data: undefined };
    case "model_redirects":
      updates.model_redirects = null;
      return { ok: true, data: undefined };
    case "allowed_models":
      updates.allowed_models = null;
      return { ok: true, data: undefined };
    case "anthropic_thinking_budget_preference":
      updates.anthropic_thinking_budget_preference = "inherit";
      return { ok: true, data: undefined };
    case "anthropic_adaptive_thinking":
      updates.anthropic_adaptive_thinking = null;
      return { ok: true, data: undefined };
    // Routing - preference fields clear to "inherit"
    case "cache_ttl_preference":
      updates.cache_ttl_preference = "inherit";
      return { ok: true, data: undefined };
    case "context_1m_preference":
      updates.context_1m_preference = "inherit";
      return { ok: true, data: undefined };
    case "codex_reasoning_effort_preference":
      updates.codex_reasoning_effort_preference = "inherit";
      return { ok: true, data: undefined };
    case "codex_reasoning_summary_preference":
      updates.codex_reasoning_summary_preference = "inherit";
      return { ok: true, data: undefined };
    case "codex_text_verbosity_preference":
      updates.codex_text_verbosity_preference = "inherit";
      return { ok: true, data: undefined };
    case "codex_parallel_tool_calls_preference":
      updates.codex_parallel_tool_calls_preference = "inherit";
      return { ok: true, data: undefined };
    case "anthropic_max_tokens_preference":
      updates.anthropic_max_tokens_preference = "inherit";
      return { ok: true, data: undefined };
    case "gemini_google_search_preference":
      updates.gemini_google_search_preference = "inherit";
      return { ok: true, data: undefined };
    // Routing - nullable fields clear to null
    case "group_priorities":
      updates.group_priorities = null;
      return { ok: true, data: undefined };
    // Rate Limit - nullable number fields clear to null
    case "limit_5h_usd":
      updates.limit_5h_usd = null;
      return { ok: true, data: undefined };
    case "limit_daily_usd":
      updates.limit_daily_usd = null;
      return { ok: true, data: undefined };
    case "limit_weekly_usd":
      updates.limit_weekly_usd = null;
      return { ok: true, data: undefined };
    case "limit_monthly_usd":
      updates.limit_monthly_usd = null;
      return { ok: true, data: undefined };
    case "limit_total_usd":
      updates.limit_total_usd = null;
      return { ok: true, data: undefined };
    // Circuit Breaker
    case "max_retry_attempts":
      updates.max_retry_attempts = null;
      return { ok: true, data: undefined };
    // Network
    case "proxy_url":
      updates.proxy_url = null;
      return { ok: true, data: undefined };
    // MCP
    case "mcp_passthrough_url":
      updates.mcp_passthrough_url = null;
      return { ok: true, data: undefined };
    default:
      return createInvalidPatchShapeError(field, "clear mode is not supported for this field");
  }
}

export function buildProviderBatchApplyUpdates(
  patch: ProviderBatchPatch
): ProviderPatchResult<ProviderBatchApplyUpdates> {
  const updates: ProviderBatchApplyUpdates = {};

  const operations: Array<[ProviderBatchPatchField, ProviderPatchOperation<unknown>]> = [
    ["is_enabled", patch.is_enabled],
    ["priority", patch.priority],
    ["weight", patch.weight],
    ["cost_multiplier", patch.cost_multiplier],
    ["group_tag", patch.group_tag],
    ["model_redirects", patch.model_redirects],
    ["allowed_models", patch.allowed_models],
    ["anthropic_thinking_budget_preference", patch.anthropic_thinking_budget_preference],
    ["anthropic_adaptive_thinking", patch.anthropic_adaptive_thinking],
    // Routing
    ["preserve_client_ip", patch.preserve_client_ip],
    ["group_priorities", patch.group_priorities],
    ["cache_ttl_preference", patch.cache_ttl_preference],
    ["swap_cache_ttl_billing", patch.swap_cache_ttl_billing],
    ["context_1m_preference", patch.context_1m_preference],
    ["codex_reasoning_effort_preference", patch.codex_reasoning_effort_preference],
    ["codex_reasoning_summary_preference", patch.codex_reasoning_summary_preference],
    ["codex_text_verbosity_preference", patch.codex_text_verbosity_preference],
    ["codex_parallel_tool_calls_preference", patch.codex_parallel_tool_calls_preference],
    ["anthropic_max_tokens_preference", patch.anthropic_max_tokens_preference],
    ["gemini_google_search_preference", patch.gemini_google_search_preference],
    // Rate Limit
    ["limit_5h_usd", patch.limit_5h_usd],
    ["limit_daily_usd", patch.limit_daily_usd],
    ["daily_reset_mode", patch.daily_reset_mode],
    ["daily_reset_time", patch.daily_reset_time],
    ["limit_weekly_usd", patch.limit_weekly_usd],
    ["limit_monthly_usd", patch.limit_monthly_usd],
    ["limit_total_usd", patch.limit_total_usd],
    ["limit_concurrent_sessions", patch.limit_concurrent_sessions],
    // Circuit Breaker
    ["circuit_breaker_failure_threshold", patch.circuit_breaker_failure_threshold],
    ["circuit_breaker_open_duration", patch.circuit_breaker_open_duration],
    [
      "circuit_breaker_half_open_success_threshold",
      patch.circuit_breaker_half_open_success_threshold,
    ],
    ["max_retry_attempts", patch.max_retry_attempts],
    // Network
    ["proxy_url", patch.proxy_url],
    ["proxy_fallback_to_direct", patch.proxy_fallback_to_direct],
    ["first_byte_timeout_streaming_ms", patch.first_byte_timeout_streaming_ms],
    ["streaming_idle_timeout_ms", patch.streaming_idle_timeout_ms],
    ["request_timeout_non_streaming_ms", patch.request_timeout_non_streaming_ms],
    // MCP
    ["mcp_passthrough_type", patch.mcp_passthrough_type],
    ["mcp_passthrough_url", patch.mcp_passthrough_url],
  ];

  for (const [field, operation] of operations) {
    const applyResult = applyPatchField(updates, field, operation);
    if (!applyResult.ok) {
      return applyResult;
    }
  }

  return { ok: true, data: updates };
}

export function hasProviderBatchPatchChanges(patch: ProviderBatchPatch): boolean {
  return (
    patch.is_enabled.mode !== "no_change" ||
    patch.priority.mode !== "no_change" ||
    patch.weight.mode !== "no_change" ||
    patch.cost_multiplier.mode !== "no_change" ||
    patch.group_tag.mode !== "no_change" ||
    patch.model_redirects.mode !== "no_change" ||
    patch.allowed_models.mode !== "no_change" ||
    patch.anthropic_thinking_budget_preference.mode !== "no_change" ||
    patch.anthropic_adaptive_thinking.mode !== "no_change" ||
    // Routing
    patch.preserve_client_ip.mode !== "no_change" ||
    patch.group_priorities.mode !== "no_change" ||
    patch.cache_ttl_preference.mode !== "no_change" ||
    patch.swap_cache_ttl_billing.mode !== "no_change" ||
    patch.context_1m_preference.mode !== "no_change" ||
    patch.codex_reasoning_effort_preference.mode !== "no_change" ||
    patch.codex_reasoning_summary_preference.mode !== "no_change" ||
    patch.codex_text_verbosity_preference.mode !== "no_change" ||
    patch.codex_parallel_tool_calls_preference.mode !== "no_change" ||
    patch.anthropic_max_tokens_preference.mode !== "no_change" ||
    patch.gemini_google_search_preference.mode !== "no_change" ||
    // Rate Limit
    patch.limit_5h_usd.mode !== "no_change" ||
    patch.limit_daily_usd.mode !== "no_change" ||
    patch.daily_reset_mode.mode !== "no_change" ||
    patch.daily_reset_time.mode !== "no_change" ||
    patch.limit_weekly_usd.mode !== "no_change" ||
    patch.limit_monthly_usd.mode !== "no_change" ||
    patch.limit_total_usd.mode !== "no_change" ||
    patch.limit_concurrent_sessions.mode !== "no_change" ||
    // Circuit Breaker
    patch.circuit_breaker_failure_threshold.mode !== "no_change" ||
    patch.circuit_breaker_open_duration.mode !== "no_change" ||
    patch.circuit_breaker_half_open_success_threshold.mode !== "no_change" ||
    patch.max_retry_attempts.mode !== "no_change" ||
    // Network
    patch.proxy_url.mode !== "no_change" ||
    patch.proxy_fallback_to_direct.mode !== "no_change" ||
    patch.first_byte_timeout_streaming_ms.mode !== "no_change" ||
    patch.streaming_idle_timeout_ms.mode !== "no_change" ||
    patch.request_timeout_non_streaming_ms.mode !== "no_change" ||
    // MCP
    patch.mcp_passthrough_type.mode !== "no_change" ||
    patch.mcp_passthrough_url.mode !== "no_change"
  );
}

export function prepareProviderBatchApplyUpdates(
  draft: unknown
): ProviderPatchResult<ProviderBatchApplyUpdates> {
  const normalized = normalizeProviderBatchPatchDraft(draft);
  if (!normalized.ok) {
    return normalized;
  }

  return buildProviderBatchApplyUpdates(normalized.data);
}
