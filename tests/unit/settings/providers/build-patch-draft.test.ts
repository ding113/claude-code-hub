import { describe, expect, it } from "vitest";
import { buildPatchDraftFromFormState } from "@/app/[locale]/settings/providers/_components/batch-edit/build-patch-draft";
import type { ProviderFormState } from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBatchState(): ProviderFormState {
  return {
    basic: { name: "", url: "", key: "", websiteUrl: "" },
    routing: {
      providerType: "claude",
      groupTag: [],
      preserveClientIp: false,
      modelRedirects: {},
      allowedModels: [],
      priority: 0,
      groupPriorities: {},
      weight: 1,
      costMultiplier: 1.0,
      cacheTtlPreference: "inherit",
      swapCacheTtlBilling: false,
      context1mPreference: "inherit",
      codexReasoningEffortPreference: "inherit",
      codexReasoningSummaryPreference: "inherit",
      codexTextVerbosityPreference: "inherit",
      codexParallelToolCallsPreference: "inherit",
      anthropicMaxTokensPreference: "inherit",
      anthropicThinkingBudgetPreference: "inherit",
      anthropicAdaptiveThinking: null,
      geminiGoogleSearchPreference: "inherit",
    },
    rateLimit: {
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
    },
    circuitBreaker: {
      failureThreshold: undefined,
      openDurationMinutes: undefined,
      halfOpenSuccessThreshold: undefined,
      maxRetryAttempts: null,
    },
    network: {
      proxyUrl: "",
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingSeconds: undefined,
      streamingIdleTimeoutSeconds: undefined,
      requestTimeoutNonStreamingSeconds: undefined,
    },
    mcp: {
      mcpPassthroughType: "none",
      mcpPassthroughUrl: "",
    },
    batch: { isEnabled: "no_change" },
    ui: {
      activeTab: "basic",
      isPending: false,
      showFailureThresholdConfirm: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPatchDraftFromFormState", () => {
  it("returns empty draft when no fields are dirty", () => {
    const state = createBatchState();
    const dirty = new Set<string>();

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft).toEqual({});
  });

  it("includes isEnabled=true when dirty and set to true", () => {
    const state = createBatchState();
    state.batch.isEnabled = "true";
    const dirty = new Set(["batch.isEnabled"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.is_enabled).toEqual({ set: true });
  });

  it("includes isEnabled=false when dirty and set to false", () => {
    const state = createBatchState();
    state.batch.isEnabled = "false";
    const dirty = new Set(["batch.isEnabled"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.is_enabled).toEqual({ set: false });
  });

  it("skips isEnabled when dirty but value is no_change", () => {
    const state = createBatchState();
    state.batch.isEnabled = "no_change";
    const dirty = new Set(["batch.isEnabled"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.is_enabled).toBeUndefined();
  });

  it("sets priority when dirty", () => {
    const state = createBatchState();
    state.routing.priority = 10;
    const dirty = new Set(["routing.priority"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.priority).toEqual({ set: 10 });
  });

  it("sets weight when dirty", () => {
    const state = createBatchState();
    state.routing.weight = 5;
    const dirty = new Set(["routing.weight"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.weight).toEqual({ set: 5 });
  });

  it("sets costMultiplier when dirty", () => {
    const state = createBatchState();
    state.routing.costMultiplier = 2.5;
    const dirty = new Set(["routing.costMultiplier"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.cost_multiplier).toEqual({ set: 2.5 });
  });

  it("clears groupTag when dirty and empty array", () => {
    const state = createBatchState();
    state.routing.groupTag = [];
    const dirty = new Set(["routing.groupTag"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.group_tag).toEqual({ clear: true });
  });

  it("sets groupTag with joined value when dirty and non-empty", () => {
    const state = createBatchState();
    state.routing.groupTag = ["tagA", "tagB"];
    const dirty = new Set(["routing.groupTag"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.group_tag).toEqual({ set: "tagA, tagB" });
  });

  it("clears modelRedirects when dirty and empty object", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.modelRedirects"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.model_redirects).toEqual({ clear: true });
  });

  it("sets modelRedirects when dirty and has entries", () => {
    const state = createBatchState();
    state.routing.modelRedirects = { "model-a": "model-b" };
    const dirty = new Set(["routing.modelRedirects"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.model_redirects).toEqual({ set: { "model-a": "model-b" } });
  });

  it("clears allowedModels when dirty and empty array", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.allowedModels"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.allowed_models).toEqual({ clear: true });
  });

  it("sets allowedModels when dirty and non-empty", () => {
    const state = createBatchState();
    state.routing.allowedModels = ["claude-opus-4-6"];
    const dirty = new Set(["routing.allowedModels"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.allowed_models).toEqual({ set: ["claude-opus-4-6"] });
  });

  // --- inherit/clear pattern fields ---

  it("clears cacheTtlPreference when dirty and inherit", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.cacheTtlPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.cache_ttl_preference).toEqual({ clear: true });
  });

  it("sets cacheTtlPreference when dirty and not inherit", () => {
    const state = createBatchState();
    state.routing.cacheTtlPreference = "5m";
    const dirty = new Set(["routing.cacheTtlPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.cache_ttl_preference).toEqual({ set: "5m" });
  });

  it("sets preserveClientIp when dirty", () => {
    const state = createBatchState();
    state.routing.preserveClientIp = true;
    const dirty = new Set(["routing.preserveClientIp"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.preserve_client_ip).toEqual({ set: true });
  });

  it("sets swapCacheTtlBilling when dirty", () => {
    const state = createBatchState();
    state.routing.swapCacheTtlBilling = true;
    const dirty = new Set(["routing.swapCacheTtlBilling"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.swap_cache_ttl_billing).toEqual({ set: true });
  });

  it("clears context1mPreference when dirty and inherit", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.context1mPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.context_1m_preference).toEqual({ clear: true });
  });

  it("sets context1mPreference when dirty and not inherit", () => {
    const state = createBatchState();
    state.routing.context1mPreference = "force_enable";
    const dirty = new Set(["routing.context1mPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.context_1m_preference).toEqual({ set: "force_enable" });
  });

  it("clears codexReasoningEffortPreference when dirty and inherit", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.codexReasoningEffortPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.codex_reasoning_effort_preference).toEqual({ clear: true });
  });

  it("sets codexReasoningEffortPreference when dirty and not inherit", () => {
    const state = createBatchState();
    state.routing.codexReasoningEffortPreference = "high";
    const dirty = new Set(["routing.codexReasoningEffortPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.codex_reasoning_effort_preference).toEqual({ set: "high" });
  });

  it("clears anthropicThinkingBudgetPreference when dirty and inherit", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.anthropicThinkingBudgetPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.anthropic_thinking_budget_preference).toEqual({ clear: true });
  });

  it("sets anthropicThinkingBudgetPreference when dirty and not inherit", () => {
    const state = createBatchState();
    state.routing.anthropicThinkingBudgetPreference = "32000";
    const dirty = new Set(["routing.anthropicThinkingBudgetPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.anthropic_thinking_budget_preference).toEqual({ set: "32000" });
  });

  it("clears anthropicAdaptiveThinking when dirty and null", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.anthropicAdaptiveThinking"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.anthropic_adaptive_thinking).toEqual({ clear: true });
  });

  it("sets anthropicAdaptiveThinking when dirty and configured", () => {
    const state = createBatchState();
    state.routing.anthropicAdaptiveThinking = {
      effort: "high",
      modelMatchMode: "specific",
      models: ["claude-opus-4-6"],
    };
    const dirty = new Set(["routing.anthropicAdaptiveThinking"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.anthropic_adaptive_thinking).toEqual({
      set: {
        effort: "high",
        modelMatchMode: "specific",
        models: ["claude-opus-4-6"],
      },
    });
  });

  it("clears geminiGoogleSearchPreference when dirty and inherit", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.geminiGoogleSearchPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.gemini_google_search_preference).toEqual({ clear: true });
  });

  it("sets geminiGoogleSearchPreference when dirty and not inherit", () => {
    const state = createBatchState();
    state.routing.geminiGoogleSearchPreference = "enabled";
    const dirty = new Set(["routing.geminiGoogleSearchPreference"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.gemini_google_search_preference).toEqual({ set: "enabled" });
  });

  // --- Rate limit fields ---

  it("clears limit5hUsd when dirty and null", () => {
    const state = createBatchState();
    const dirty = new Set(["rateLimit.limit5hUsd"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.limit_5h_usd).toEqual({ clear: true });
  });

  it("sets limit5hUsd when dirty and has value", () => {
    const state = createBatchState();
    state.rateLimit.limit5hUsd = 50;
    const dirty = new Set(["rateLimit.limit5hUsd"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.limit_5h_usd).toEqual({ set: 50 });
  });

  it("sets dailyResetMode when dirty", () => {
    const state = createBatchState();
    state.rateLimit.dailyResetMode = "rolling";
    const dirty = new Set(["rateLimit.dailyResetMode"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.daily_reset_mode).toEqual({ set: "rolling" });
  });

  it("sets dailyResetTime when dirty", () => {
    const state = createBatchState();
    state.rateLimit.dailyResetTime = "12:00";
    const dirty = new Set(["rateLimit.dailyResetTime"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.daily_reset_time).toEqual({ set: "12:00" });
  });

  it("clears maxRetryAttempts when dirty and null", () => {
    const state = createBatchState();
    const dirty = new Set(["circuitBreaker.maxRetryAttempts"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.max_retry_attempts).toEqual({ clear: true });
  });

  it("sets maxRetryAttempts when dirty and has value", () => {
    const state = createBatchState();
    state.circuitBreaker.maxRetryAttempts = 3;
    const dirty = new Set(["circuitBreaker.maxRetryAttempts"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.max_retry_attempts).toEqual({ set: 3 });
  });

  // --- Unit conversion: circuit breaker minutes -> ms ---

  it("converts openDurationMinutes to ms", () => {
    const state = createBatchState();
    state.circuitBreaker.openDurationMinutes = 5;
    const dirty = new Set(["circuitBreaker.openDurationMinutes"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.circuit_breaker_open_duration).toEqual({ set: 300000 });
  });

  it("sets openDuration to 0 when dirty and undefined", () => {
    const state = createBatchState();
    const dirty = new Set(["circuitBreaker.openDurationMinutes"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.circuit_breaker_open_duration).toEqual({ set: 0 });
  });

  it("sets failureThreshold to 0 when dirty and undefined", () => {
    const state = createBatchState();
    const dirty = new Set(["circuitBreaker.failureThreshold"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.circuit_breaker_failure_threshold).toEqual({ set: 0 });
  });

  it("sets failureThreshold when dirty and has value", () => {
    const state = createBatchState();
    state.circuitBreaker.failureThreshold = 10;
    const dirty = new Set(["circuitBreaker.failureThreshold"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.circuit_breaker_failure_threshold).toEqual({ set: 10 });
  });

  // --- Unit conversion: network seconds -> ms ---

  it("converts firstByteTimeoutStreamingSeconds to ms", () => {
    const state = createBatchState();
    state.network.firstByteTimeoutStreamingSeconds = 30;
    const dirty = new Set(["network.firstByteTimeoutStreamingSeconds"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.first_byte_timeout_streaming_ms).toEqual({ set: 30000 });
  });

  it("skips firstByteTimeoutStreamingMs when dirty and undefined", () => {
    const state = createBatchState();
    const dirty = new Set(["network.firstByteTimeoutStreamingSeconds"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.first_byte_timeout_streaming_ms).toBeUndefined();
  });

  it("converts streamingIdleTimeoutSeconds to ms", () => {
    const state = createBatchState();
    state.network.streamingIdleTimeoutSeconds = 120;
    const dirty = new Set(["network.streamingIdleTimeoutSeconds"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.streaming_idle_timeout_ms).toEqual({ set: 120000 });
  });

  it("converts requestTimeoutNonStreamingSeconds to ms", () => {
    const state = createBatchState();
    state.network.requestTimeoutNonStreamingSeconds = 60;
    const dirty = new Set(["network.requestTimeoutNonStreamingSeconds"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.request_timeout_non_streaming_ms).toEqual({ set: 60000 });
  });

  // --- Network fields ---

  it("clears proxyUrl when dirty and empty string", () => {
    const state = createBatchState();
    const dirty = new Set(["network.proxyUrl"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.proxy_url).toEqual({ clear: true });
  });

  it("sets proxyUrl when dirty and has value", () => {
    const state = createBatchState();
    state.network.proxyUrl = "socks5://proxy.example.com:1080";
    const dirty = new Set(["network.proxyUrl"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.proxy_url).toEqual({ set: "socks5://proxy.example.com:1080" });
  });

  it("sets proxyFallbackToDirect when dirty", () => {
    const state = createBatchState();
    state.network.proxyFallbackToDirect = true;
    const dirty = new Set(["network.proxyFallbackToDirect"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.proxy_fallback_to_direct).toEqual({ set: true });
  });

  // --- MCP fields ---

  it("sets mcpPassthroughType when dirty", () => {
    const state = createBatchState();
    state.mcp.mcpPassthroughType = "minimax";
    const dirty = new Set(["mcp.mcpPassthroughType"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.mcp_passthrough_type).toEqual({ set: "minimax" });
  });

  it("sets mcpPassthroughType to none when dirty", () => {
    const state = createBatchState();
    const dirty = new Set(["mcp.mcpPassthroughType"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.mcp_passthrough_type).toEqual({ set: "none" });
  });

  it("clears mcpPassthroughUrl when dirty and empty", () => {
    const state = createBatchState();
    const dirty = new Set(["mcp.mcpPassthroughUrl"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.mcp_passthrough_url).toEqual({ clear: true });
  });

  it("sets mcpPassthroughUrl when dirty and has value", () => {
    const state = createBatchState();
    state.mcp.mcpPassthroughUrl = "https://mcp.example.com";
    const dirty = new Set(["mcp.mcpPassthroughUrl"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.mcp_passthrough_url).toEqual({ set: "https://mcp.example.com" });
  });

  // --- Multi-field scenario ---

  it("only includes dirty fields in draft, ignoring non-dirty", () => {
    const state = createBatchState();
    state.routing.priority = 10;
    state.routing.weight = 5;
    state.routing.costMultiplier = 2.0;

    // Only mark priority as dirty
    const dirty = new Set(["routing.priority"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.priority).toEqual({ set: 10 });
    expect(draft.weight).toBeUndefined();
    expect(draft.cost_multiplier).toBeUndefined();
  });

  it("handles multiple dirty fields correctly", () => {
    const state = createBatchState();
    state.batch.isEnabled = "true";
    state.routing.priority = 5;
    state.routing.weight = 3;
    state.rateLimit.limit5hUsd = 100;
    state.network.proxyUrl = "http://proxy:8080";

    const dirty = new Set([
      "batch.isEnabled",
      "routing.priority",
      "routing.weight",
      "rateLimit.limit5hUsd",
      "network.proxyUrl",
    ]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.is_enabled).toEqual({ set: true });
    expect(draft.priority).toEqual({ set: 5 });
    expect(draft.weight).toEqual({ set: 3 });
    expect(draft.limit_5h_usd).toEqual({ set: 100 });
    expect(draft.proxy_url).toEqual({ set: "http://proxy:8080" });
    // Non-dirty fields should be absent
    expect(draft.cost_multiplier).toBeUndefined();
    expect(draft.group_tag).toBeUndefined();
  });

  // --- groupPriorities ---

  it("clears groupPriorities when dirty and empty object", () => {
    const state = createBatchState();
    const dirty = new Set(["routing.groupPriorities"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.group_priorities).toEqual({ clear: true });
  });

  it("sets groupPriorities when dirty and has entries", () => {
    const state = createBatchState();
    state.routing.groupPriorities = { groupA: 1, groupB: 2 };
    const dirty = new Set(["routing.groupPriorities"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.group_priorities).toEqual({ set: { groupA: 1, groupB: 2 } });
  });

  // --- limitConcurrentSessions null -> 0 edge case ---

  it("sets limitConcurrentSessions to 0 when dirty and null", () => {
    const state = createBatchState();
    const dirty = new Set(["rateLimit.limitConcurrentSessions"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.limit_concurrent_sessions).toEqual({ set: 0 });
  });

  it("sets limitConcurrentSessions when dirty and has value", () => {
    const state = createBatchState();
    state.rateLimit.limitConcurrentSessions = 20;
    const dirty = new Set(["rateLimit.limitConcurrentSessions"]);

    const draft = buildPatchDraftFromFormState(state, dirty);

    expect(draft.limit_concurrent_sessions).toEqual({ set: 20 });
  });
});
