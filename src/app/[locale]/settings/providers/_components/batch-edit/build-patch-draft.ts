import type { ProviderBatchPatchDraft } from "@/types/provider";
import type { ProviderFormState } from "../forms/provider-form/provider-form-types";

/**
 * Builds a ProviderBatchPatchDraft from the current form state,
 * including only fields that the user has actually modified (dirty fields).
 *
 * Unit conversions:
 * - circuitBreaker.openDurationMinutes (minutes) -> circuit_breaker_open_duration (ms)
 * - network.*Seconds (seconds) -> *_ms (ms)
 */
export function buildPatchDraftFromFormState(
  state: ProviderFormState,
  dirtyFields: Set<string>
): ProviderBatchPatchDraft {
  const draft: ProviderBatchPatchDraft = {};

  // Batch-specific: isEnabled
  if (dirtyFields.has("batch.isEnabled")) {
    if (state.batch.isEnabled !== "no_change") {
      draft.is_enabled = { set: state.batch.isEnabled === "true" };
    }
  }

  // Routing fields
  if (dirtyFields.has("routing.priority")) {
    draft.priority = { set: state.routing.priority };
  }
  if (dirtyFields.has("routing.weight")) {
    draft.weight = { set: state.routing.weight };
  }
  if (dirtyFields.has("routing.costMultiplier")) {
    draft.cost_multiplier = { set: state.routing.costMultiplier };
  }
  if (dirtyFields.has("routing.groupTag")) {
    const joined = state.routing.groupTag.join(", ");
    if (joined === "") {
      draft.group_tag = { clear: true };
    } else {
      draft.group_tag = { set: joined };
    }
  }
  if (dirtyFields.has("routing.preserveClientIp")) {
    draft.preserve_client_ip = { set: state.routing.preserveClientIp };
  }
  if (dirtyFields.has("routing.modelRedirects")) {
    const entries = Object.keys(state.routing.modelRedirects);
    if (entries.length === 0) {
      draft.model_redirects = { clear: true };
    } else {
      draft.model_redirects = { set: state.routing.modelRedirects };
    }
  }
  if (dirtyFields.has("routing.allowedModels")) {
    if (state.routing.allowedModels.length === 0) {
      draft.allowed_models = { clear: true };
    } else {
      draft.allowed_models = { set: state.routing.allowedModels };
    }
  }
  if (dirtyFields.has("routing.groupPriorities")) {
    const entries = Object.keys(state.routing.groupPriorities);
    if (entries.length === 0) {
      draft.group_priorities = { clear: true };
    } else {
      draft.group_priorities = { set: state.routing.groupPriorities };
    }
  }
  if (dirtyFields.has("routing.cacheTtlPreference")) {
    if (state.routing.cacheTtlPreference === "inherit") {
      draft.cache_ttl_preference = { clear: true };
    } else {
      draft.cache_ttl_preference = { set: state.routing.cacheTtlPreference };
    }
  }
  if (dirtyFields.has("routing.swapCacheTtlBilling")) {
    draft.swap_cache_ttl_billing = { set: state.routing.swapCacheTtlBilling };
  }
  if (dirtyFields.has("routing.context1mPreference")) {
    if (state.routing.context1mPreference === "inherit") {
      draft.context_1m_preference = { clear: true };
    } else {
      draft.context_1m_preference = { set: state.routing.context1mPreference };
    }
  }

  // Codex preferences
  if (dirtyFields.has("routing.codexReasoningEffortPreference")) {
    if (state.routing.codexReasoningEffortPreference === "inherit") {
      draft.codex_reasoning_effort_preference = { clear: true };
    } else {
      draft.codex_reasoning_effort_preference = {
        set: state.routing.codexReasoningEffortPreference,
      };
    }
  }
  if (dirtyFields.has("routing.codexReasoningSummaryPreference")) {
    if (state.routing.codexReasoningSummaryPreference === "inherit") {
      draft.codex_reasoning_summary_preference = { clear: true };
    } else {
      draft.codex_reasoning_summary_preference = {
        set: state.routing.codexReasoningSummaryPreference,
      };
    }
  }
  if (dirtyFields.has("routing.codexTextVerbosityPreference")) {
    if (state.routing.codexTextVerbosityPreference === "inherit") {
      draft.codex_text_verbosity_preference = { clear: true };
    } else {
      draft.codex_text_verbosity_preference = { set: state.routing.codexTextVerbosityPreference };
    }
  }
  if (dirtyFields.has("routing.codexParallelToolCallsPreference")) {
    if (state.routing.codexParallelToolCallsPreference === "inherit") {
      draft.codex_parallel_tool_calls_preference = { clear: true };
    } else {
      draft.codex_parallel_tool_calls_preference = {
        set: state.routing.codexParallelToolCallsPreference,
      };
    }
  }

  // Anthropic preferences
  if (dirtyFields.has("routing.anthropicMaxTokensPreference")) {
    if (state.routing.anthropicMaxTokensPreference === "inherit") {
      draft.anthropic_max_tokens_preference = { clear: true };
    } else {
      draft.anthropic_max_tokens_preference = { set: state.routing.anthropicMaxTokensPreference };
    }
  }
  if (dirtyFields.has("routing.anthropicThinkingBudgetPreference")) {
    if (state.routing.anthropicThinkingBudgetPreference === "inherit") {
      draft.anthropic_thinking_budget_preference = { clear: true };
    } else {
      draft.anthropic_thinking_budget_preference = {
        set: state.routing.anthropicThinkingBudgetPreference,
      };
    }
  }
  if (dirtyFields.has("routing.anthropicAdaptiveThinking")) {
    if (state.routing.anthropicAdaptiveThinking === null) {
      draft.anthropic_adaptive_thinking = { clear: true };
    } else {
      draft.anthropic_adaptive_thinking = { set: state.routing.anthropicAdaptiveThinking };
    }
  }

  // Gemini preferences
  if (dirtyFields.has("routing.geminiGoogleSearchPreference")) {
    if (state.routing.geminiGoogleSearchPreference === "inherit") {
      draft.gemini_google_search_preference = { clear: true };
    } else {
      draft.gemini_google_search_preference = { set: state.routing.geminiGoogleSearchPreference };
    }
  }

  // Rate limit fields
  if (dirtyFields.has("rateLimit.limit5hUsd")) {
    if (state.rateLimit.limit5hUsd === null) {
      draft.limit_5h_usd = { clear: true };
    } else {
      draft.limit_5h_usd = { set: state.rateLimit.limit5hUsd };
    }
  }
  if (dirtyFields.has("rateLimit.limitDailyUsd")) {
    if (state.rateLimit.limitDailyUsd === null) {
      draft.limit_daily_usd = { clear: true };
    } else {
      draft.limit_daily_usd = { set: state.rateLimit.limitDailyUsd };
    }
  }
  if (dirtyFields.has("rateLimit.dailyResetMode")) {
    draft.daily_reset_mode = { set: state.rateLimit.dailyResetMode };
  }
  if (dirtyFields.has("rateLimit.dailyResetTime")) {
    draft.daily_reset_time = { set: state.rateLimit.dailyResetTime };
  }
  if (dirtyFields.has("rateLimit.limitWeeklyUsd")) {
    if (state.rateLimit.limitWeeklyUsd === null) {
      draft.limit_weekly_usd = { clear: true };
    } else {
      draft.limit_weekly_usd = { set: state.rateLimit.limitWeeklyUsd };
    }
  }
  if (dirtyFields.has("rateLimit.limitMonthlyUsd")) {
    if (state.rateLimit.limitMonthlyUsd === null) {
      draft.limit_monthly_usd = { clear: true };
    } else {
      draft.limit_monthly_usd = { set: state.rateLimit.limitMonthlyUsd };
    }
  }
  if (dirtyFields.has("rateLimit.limitTotalUsd")) {
    if (state.rateLimit.limitTotalUsd === null) {
      draft.limit_total_usd = { clear: true };
    } else {
      draft.limit_total_usd = { set: state.rateLimit.limitTotalUsd };
    }
  }
  if (dirtyFields.has("rateLimit.limitConcurrentSessions")) {
    if (state.rateLimit.limitConcurrentSessions === null) {
      draft.limit_concurrent_sessions = { set: 0 };
    } else {
      draft.limit_concurrent_sessions = { set: state.rateLimit.limitConcurrentSessions };
    }
  }

  // Circuit breaker fields (minutes -> ms conversion for open duration)
  if (dirtyFields.has("circuitBreaker.failureThreshold")) {
    if (state.circuitBreaker.failureThreshold === undefined) {
      draft.circuit_breaker_failure_threshold = { set: 0 };
    } else {
      draft.circuit_breaker_failure_threshold = { set: state.circuitBreaker.failureThreshold };
    }
  }
  if (dirtyFields.has("circuitBreaker.openDurationMinutes")) {
    if (state.circuitBreaker.openDurationMinutes === undefined) {
      draft.circuit_breaker_open_duration = { set: 0 };
    } else {
      // Convert minutes to milliseconds
      draft.circuit_breaker_open_duration = {
        set: state.circuitBreaker.openDurationMinutes * 60000,
      };
    }
  }
  if (dirtyFields.has("circuitBreaker.halfOpenSuccessThreshold")) {
    if (state.circuitBreaker.halfOpenSuccessThreshold === undefined) {
      draft.circuit_breaker_half_open_success_threshold = { set: 0 };
    } else {
      draft.circuit_breaker_half_open_success_threshold = {
        set: state.circuitBreaker.halfOpenSuccessThreshold,
      };
    }
  }
  if (dirtyFields.has("circuitBreaker.maxRetryAttempts")) {
    if (state.circuitBreaker.maxRetryAttempts === null) {
      draft.max_retry_attempts = { clear: true };
    } else {
      draft.max_retry_attempts = { set: state.circuitBreaker.maxRetryAttempts };
    }
  }

  // Network fields (seconds -> ms conversion)
  if (dirtyFields.has("network.proxyUrl")) {
    if (state.network.proxyUrl === "") {
      draft.proxy_url = { clear: true };
    } else {
      draft.proxy_url = { set: state.network.proxyUrl };
    }
  }
  if (dirtyFields.has("network.proxyFallbackToDirect")) {
    draft.proxy_fallback_to_direct = { set: state.network.proxyFallbackToDirect };
  }
  if (dirtyFields.has("network.firstByteTimeoutStreamingSeconds")) {
    if (state.network.firstByteTimeoutStreamingSeconds !== undefined) {
      draft.first_byte_timeout_streaming_ms = {
        set: state.network.firstByteTimeoutStreamingSeconds * 1000,
      };
    }
  }
  if (dirtyFields.has("network.streamingIdleTimeoutSeconds")) {
    if (state.network.streamingIdleTimeoutSeconds !== undefined) {
      draft.streaming_idle_timeout_ms = { set: state.network.streamingIdleTimeoutSeconds * 1000 };
    }
  }
  if (dirtyFields.has("network.requestTimeoutNonStreamingSeconds")) {
    if (state.network.requestTimeoutNonStreamingSeconds !== undefined) {
      draft.request_timeout_non_streaming_ms = {
        set: state.network.requestTimeoutNonStreamingSeconds * 1000,
      };
    }
  }

  // MCP fields
  if (dirtyFields.has("mcp.mcpPassthroughType")) {
    if (state.mcp.mcpPassthroughType === "none") {
      draft.mcp_passthrough_type = { set: "none" };
    } else {
      draft.mcp_passthrough_type = { set: state.mcp.mcpPassthroughType };
    }
  }
  if (dirtyFields.has("mcp.mcpPassthroughUrl")) {
    if (state.mcp.mcpPassthroughUrl === "") {
      draft.mcp_passthrough_url = { clear: true };
    } else {
      draft.mcp_passthrough_url = { set: state.mcp.mcpPassthroughUrl };
    }
  }

  return draft;
}
