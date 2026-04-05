"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { normalizeAllowedModelRules } from "@/lib/provider-allowed-models";
import { normalizeProviderModelRedirectRules } from "@/lib/provider-model-redirects";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { analyzeBatchProviderSettings } from "../../batch-edit/analyze-batch-settings";
import type {
  FormMode,
  ProviderFormAction,
  ProviderFormContextValue,
  ProviderFormState,
} from "./provider-form-types";

// Maps action types to dirty field paths for batch mode tracking
const ACTION_TO_FIELD_PATH: Partial<Record<ProviderFormAction["type"], string>> = {
  SET_BATCH_IS_ENABLED: "batch.isEnabled",
  SET_PRIORITY: "routing.priority",
  SET_WEIGHT: "routing.weight",
  SET_COST_MULTIPLIER: "routing.costMultiplier",
  SET_GROUP_TAG: "routing.groupTag",
  SET_PRESERVE_CLIENT_IP: "routing.preserveClientIp",
  SET_DISABLE_SESSION_REUSE: "routing.disableSessionReuse",
  SET_MODEL_REDIRECTS: "routing.modelRedirects",
  SET_ALLOWED_MODELS: "routing.allowedModels",
  SET_ALLOWED_CLIENTS: "routing.allowedClients",
  SET_BLOCKED_CLIENTS: "routing.blockedClients",
  SET_GROUP_PRIORITIES: "routing.groupPriorities",
  SET_CACHE_TTL_PREFERENCE: "routing.cacheTtlPreference",
  SET_SWAP_CACHE_TTL_BILLING: "routing.swapCacheTtlBilling",
  SET_CODEX_REASONING_EFFORT: "routing.codexReasoningEffortPreference",
  SET_CODEX_REASONING_SUMMARY: "routing.codexReasoningSummaryPreference",
  SET_CODEX_TEXT_VERBOSITY: "routing.codexTextVerbosityPreference",
  SET_CODEX_PARALLEL_TOOL_CALLS: "routing.codexParallelToolCallsPreference",
  SET_CODEX_SERVICE_TIER: "routing.codexServiceTierPreference",
  SET_ANTHROPIC_MAX_TOKENS: "routing.anthropicMaxTokensPreference",
  SET_ANTHROPIC_THINKING_BUDGET: "routing.anthropicThinkingBudgetPreference",
  SET_ADAPTIVE_THINKING_ENABLED: "routing.anthropicAdaptiveThinking",
  SET_ADAPTIVE_THINKING_EFFORT: "routing.anthropicAdaptiveThinking",
  SET_ADAPTIVE_THINKING_MODEL_MATCH_MODE: "routing.anthropicAdaptiveThinking",
  SET_ADAPTIVE_THINKING_MODELS: "routing.anthropicAdaptiveThinking",
  SET_GEMINI_GOOGLE_SEARCH: "routing.geminiGoogleSearchPreference",
  SET_ACTIVE_TIME_START: "routing.activeTimeStart",
  SET_ACTIVE_TIME_END: "routing.activeTimeEnd",
  SET_LIMIT_5H_USD: "rateLimit.limit5hUsd",
  SET_LIMIT_DAILY_USD: "rateLimit.limitDailyUsd",
  SET_DAILY_RESET_MODE: "rateLimit.dailyResetMode",
  SET_DAILY_RESET_TIME: "rateLimit.dailyResetTime",
  SET_LIMIT_WEEKLY_USD: "rateLimit.limitWeeklyUsd",
  SET_LIMIT_MONTHLY_USD: "rateLimit.limitMonthlyUsd",
  SET_LIMIT_TOTAL_USD: "rateLimit.limitTotalUsd",
  SET_LIMIT_CONCURRENT_SESSIONS: "rateLimit.limitConcurrentSessions",
  SET_FAILURE_THRESHOLD: "circuitBreaker.failureThreshold",
  SET_OPEN_DURATION_MINUTES: "circuitBreaker.openDurationMinutes",
  SET_HALF_OPEN_SUCCESS_THRESHOLD: "circuitBreaker.halfOpenSuccessThreshold",
  SET_MAX_RETRY_ATTEMPTS: "circuitBreaker.maxRetryAttempts",
  SET_PROXY_URL: "network.proxyUrl",
  SET_PROXY_FALLBACK_TO_DIRECT: "network.proxyFallbackToDirect",
  SET_FIRST_BYTE_TIMEOUT_STREAMING: "network.firstByteTimeoutStreamingSeconds",
  SET_STREAMING_IDLE_TIMEOUT: "network.streamingIdleTimeoutSeconds",
  SET_REQUEST_TIMEOUT_NON_STREAMING: "network.requestTimeoutNonStreamingSeconds",
  SET_MCP_PASSTHROUGH_TYPE: "mcp.mcpPassthroughType",
  SET_MCP_PASSTHROUGH_URL: "mcp.mcpPassthroughUrl",
};

// Initial state factory
export function createInitialState(
  mode: FormMode,
  provider?: ProviderDisplay,
  cloneProvider?: ProviderDisplay,
  preset?: {
    name?: string;
    url?: string;
    websiteUrl?: string;
    providerType?: ProviderType;
  },
  batchProviders?: ProviderDisplay[]
): ProviderFormState {
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";
  const raw = isEdit ? provider : cloneProvider;
  const sourceProvider = raw ? structuredClone(raw) : undefined;

  // Batch mode: 使用分析结果预填充
  if (isBatch && batchProviders && batchProviders.length > 0) {
    const analysis = analyzeBatchProviderSettings(batchProviders);

    return {
      basic: { name: "", url: "", key: "", websiteUrl: "" },
      routing: {
        providerType: "claude", // 批量编辑不支持修改 providerType
        groupTag:
          analysis.routing.groupTag.status === "uniform" ? analysis.routing.groupTag.value : [],
        preserveClientIp:
          analysis.routing.preserveClientIp.status === "uniform"
            ? analysis.routing.preserveClientIp.value
            : false,
        disableSessionReuse:
          analysis.routing.disableSessionReuse.status === "uniform"
            ? analysis.routing.disableSessionReuse.value
            : false,
        modelRedirects:
          analysis.routing.modelRedirects.status === "uniform"
            ? analysis.routing.modelRedirects.value
            : [],
        allowedModels:
          analysis.routing.allowedModels.status === "uniform"
            ? analysis.routing.allowedModels.value
            : [],
        allowedClients:
          analysis.routing.allowedClients.status === "uniform"
            ? analysis.routing.allowedClients.value
            : [],
        blockedClients:
          analysis.routing.blockedClients.status === "uniform"
            ? analysis.routing.blockedClients.value
            : [],
        priority:
          analysis.routing.priority.status === "uniform" ? analysis.routing.priority.value : 0,
        groupPriorities:
          analysis.routing.groupPriorities.status === "uniform"
            ? analysis.routing.groupPriorities.value
            : {},
        weight: analysis.routing.weight.status === "uniform" ? analysis.routing.weight.value : 1,
        costMultiplier:
          analysis.routing.costMultiplier.status === "uniform"
            ? analysis.routing.costMultiplier.value
            : 1.0,
        cacheTtlPreference:
          analysis.routing.cacheTtlPreference.status === "uniform"
            ? analysis.routing.cacheTtlPreference.value
            : "inherit",
        swapCacheTtlBilling:
          analysis.routing.swapCacheTtlBilling.status === "uniform"
            ? analysis.routing.swapCacheTtlBilling.value
            : false,
        codexReasoningEffortPreference:
          analysis.routing.codexReasoningEffortPreference.status === "uniform"
            ? analysis.routing.codexReasoningEffortPreference.value
            : "inherit",
        codexReasoningSummaryPreference:
          analysis.routing.codexReasoningSummaryPreference.status === "uniform"
            ? analysis.routing.codexReasoningSummaryPreference.value
            : "inherit",
        codexTextVerbosityPreference:
          analysis.routing.codexTextVerbosityPreference.status === "uniform"
            ? analysis.routing.codexTextVerbosityPreference.value
            : "inherit",
        codexParallelToolCallsPreference:
          analysis.routing.codexParallelToolCallsPreference.status === "uniform"
            ? analysis.routing.codexParallelToolCallsPreference.value
            : "inherit",
        codexServiceTierPreference:
          analysis.routing.codexServiceTierPreference.status === "uniform"
            ? analysis.routing.codexServiceTierPreference.value
            : "inherit",
        anthropicMaxTokensPreference:
          analysis.routing.anthropicMaxTokensPreference.status === "uniform"
            ? analysis.routing.anthropicMaxTokensPreference.value
            : "inherit",
        anthropicThinkingBudgetPreference:
          analysis.routing.anthropicThinkingBudgetPreference.status === "uniform"
            ? analysis.routing.anthropicThinkingBudgetPreference.value
            : "inherit",
        anthropicAdaptiveThinking:
          analysis.routing.anthropicAdaptiveThinking.status === "uniform"
            ? analysis.routing.anthropicAdaptiveThinking.value
            : null,
        geminiGoogleSearchPreference:
          analysis.routing.geminiGoogleSearchPreference.status === "uniform"
            ? analysis.routing.geminiGoogleSearchPreference.value
            : "inherit",
        activeTimeStart:
          analysis.routing.activeTimeStart.status === "uniform"
            ? analysis.routing.activeTimeStart.value
            : null,
        activeTimeEnd:
          analysis.routing.activeTimeEnd.status === "uniform"
            ? analysis.routing.activeTimeEnd.value
            : null,
      },
      rateLimit: {
        limit5hUsd:
          analysis.rateLimit.limit5hUsd.status === "uniform"
            ? analysis.rateLimit.limit5hUsd.value
            : null,
        limitDailyUsd:
          analysis.rateLimit.limitDailyUsd.status === "uniform"
            ? analysis.rateLimit.limitDailyUsd.value
            : null,
        dailyResetMode:
          analysis.rateLimit.dailyResetMode.status === "uniform"
            ? analysis.rateLimit.dailyResetMode.value
            : "fixed",
        dailyResetTime:
          analysis.rateLimit.dailyResetTime.status === "uniform"
            ? analysis.rateLimit.dailyResetTime.value
            : "00:00",
        limitWeeklyUsd:
          analysis.rateLimit.limitWeeklyUsd.status === "uniform"
            ? analysis.rateLimit.limitWeeklyUsd.value
            : null,
        limitMonthlyUsd:
          analysis.rateLimit.limitMonthlyUsd.status === "uniform"
            ? analysis.rateLimit.limitMonthlyUsd.value
            : null,
        limitTotalUsd:
          analysis.rateLimit.limitTotalUsd.status === "uniform"
            ? analysis.rateLimit.limitTotalUsd.value
            : null,
        limitConcurrentSessions:
          analysis.rateLimit.limitConcurrentSessions.status === "uniform"
            ? analysis.rateLimit.limitConcurrentSessions.value
            : null,
      },
      circuitBreaker: {
        failureThreshold:
          analysis.circuitBreaker.failureThreshold.status === "uniform"
            ? analysis.circuitBreaker.failureThreshold.value
            : undefined,
        openDurationMinutes:
          analysis.circuitBreaker.openDurationMinutes.status === "uniform"
            ? analysis.circuitBreaker.openDurationMinutes.value
            : undefined,
        halfOpenSuccessThreshold:
          analysis.circuitBreaker.halfOpenSuccessThreshold.status === "uniform"
            ? analysis.circuitBreaker.halfOpenSuccessThreshold.value
            : undefined,
        maxRetryAttempts:
          analysis.circuitBreaker.maxRetryAttempts.status === "uniform"
            ? analysis.circuitBreaker.maxRetryAttempts.value
            : null,
      },
      network: {
        proxyUrl:
          analysis.network.proxyUrl.status === "uniform" ? analysis.network.proxyUrl.value : "",
        proxyFallbackToDirect:
          analysis.network.proxyFallbackToDirect.status === "uniform"
            ? analysis.network.proxyFallbackToDirect.value
            : false,
        firstByteTimeoutStreamingSeconds:
          analysis.network.firstByteTimeoutStreamingSeconds.status === "uniform"
            ? analysis.network.firstByteTimeoutStreamingSeconds.value
            : undefined,
        streamingIdleTimeoutSeconds:
          analysis.network.streamingIdleTimeoutSeconds.status === "uniform"
            ? analysis.network.streamingIdleTimeoutSeconds.value
            : undefined,
        requestTimeoutNonStreamingSeconds:
          analysis.network.requestTimeoutNonStreamingSeconds.status === "uniform"
            ? analysis.network.requestTimeoutNonStreamingSeconds.value
            : undefined,
      },
      mcp: {
        mcpPassthroughType:
          analysis.mcp.mcpPassthroughType.status === "uniform"
            ? analysis.mcp.mcpPassthroughType.value
            : "none",
        mcpPassthroughUrl:
          analysis.mcp.mcpPassthroughUrl.status === "uniform"
            ? analysis.mcp.mcpPassthroughUrl.value
            : "",
      },
      batch: { isEnabled: "no_change" },
      ui: {
        activeTab: "basic",
        activeSubTab: null,
        isPending: false,
        showFailureThresholdConfirm: false,
      },
    };
  }

  // Batch mode fallback: all fields start at neutral defaults (no provider source)
  if (isBatch) {
    return {
      basic: { name: "", url: "", key: "", websiteUrl: "" },
      routing: {
        providerType: "claude",
        groupTag: [],
        preserveClientIp: false,
        disableSessionReuse: false,
        modelRedirects: [],
        allowedModels: [],
        allowedClients: [],
        blockedClients: [],
        priority: 0,
        groupPriorities: {},
        weight: 1,
        costMultiplier: 1.0,
        cacheTtlPreference: "inherit",
        swapCacheTtlBilling: false,
        codexReasoningEffortPreference: "inherit",
        codexReasoningSummaryPreference: "inherit",
        codexTextVerbosityPreference: "inherit",
        codexParallelToolCallsPreference: "inherit",
        codexServiceTierPreference: "inherit",
        anthropicMaxTokensPreference: "inherit",
        anthropicThinkingBudgetPreference: "inherit",
        anthropicAdaptiveThinking: null,
        geminiGoogleSearchPreference: "inherit",
        activeTimeStart: null,
        activeTimeEnd: null,
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
        activeSubTab: null,
        isPending: false,
        showFailureThresholdConfirm: false,
      },
    };
  }

  return {
    basic: {
      name: isEdit
        ? (provider?.name ?? "")
        : cloneProvider
          ? `${cloneProvider.name}_Copy`
          : (preset?.name ?? ""),
      url: sourceProvider?.url ?? preset?.url ?? "",
      key: "",
      websiteUrl: sourceProvider?.websiteUrl ?? preset?.websiteUrl ?? "",
    },
    routing: {
      providerType: sourceProvider?.providerType ?? preset?.providerType ?? "claude",
      groupTag: parseProviderGroups(sourceProvider?.groupTag),
      preserveClientIp: sourceProvider?.preserveClientIp ?? false,
      disableSessionReuse: sourceProvider?.disableSessionReuse ?? false,
      modelRedirects: normalizeProviderModelRedirectRules(sourceProvider?.modelRedirects) ?? [],
      allowedModels: normalizeAllowedModelRules(sourceProvider?.allowedModels) ?? [],
      allowedClients: sourceProvider?.allowedClients ?? [],
      blockedClients: sourceProvider?.blockedClients ?? [],
      priority: sourceProvider?.priority ?? 0,
      groupPriorities: sourceProvider?.groupPriorities ?? {},
      weight: sourceProvider?.weight ?? 1,
      costMultiplier: sourceProvider?.costMultiplier ?? 1.0,
      cacheTtlPreference: sourceProvider?.cacheTtlPreference ?? "inherit",
      swapCacheTtlBilling: sourceProvider?.swapCacheTtlBilling ?? false,
      codexReasoningEffortPreference: sourceProvider?.codexReasoningEffortPreference ?? "inherit",
      codexReasoningSummaryPreference: sourceProvider?.codexReasoningSummaryPreference ?? "inherit",
      codexTextVerbosityPreference: sourceProvider?.codexTextVerbosityPreference ?? "inherit",
      codexParallelToolCallsPreference:
        sourceProvider?.codexParallelToolCallsPreference ?? "inherit",
      codexServiceTierPreference: sourceProvider?.codexServiceTierPreference ?? "inherit",
      anthropicMaxTokensPreference: sourceProvider?.anthropicMaxTokensPreference ?? "inherit",
      anthropicThinkingBudgetPreference:
        sourceProvider?.anthropicThinkingBudgetPreference ?? "inherit",
      anthropicAdaptiveThinking: sourceProvider?.anthropicAdaptiveThinking ?? null,
      geminiGoogleSearchPreference: sourceProvider?.geminiGoogleSearchPreference ?? "inherit",
      activeTimeStart: sourceProvider?.activeTimeStart ?? null,
      activeTimeEnd: sourceProvider?.activeTimeEnd ?? null,
    },
    rateLimit: {
      limit5hUsd: sourceProvider?.limit5hUsd ?? null,
      limitDailyUsd: sourceProvider?.limitDailyUsd ?? null,
      dailyResetMode: sourceProvider?.dailyResetMode ?? "fixed",
      dailyResetTime: sourceProvider?.dailyResetTime ?? "00:00",
      limitWeeklyUsd: sourceProvider?.limitWeeklyUsd ?? null,
      limitMonthlyUsd: sourceProvider?.limitMonthlyUsd ?? null,
      limitTotalUsd: sourceProvider?.limitTotalUsd ?? null,
      limitConcurrentSessions: sourceProvider?.limitConcurrentSessions ?? null,
    },
    circuitBreaker: {
      failureThreshold: sourceProvider?.circuitBreakerFailureThreshold,
      openDurationMinutes: sourceProvider?.circuitBreakerOpenDuration
        ? sourceProvider.circuitBreakerOpenDuration / 60000
        : undefined,
      halfOpenSuccessThreshold: sourceProvider?.circuitBreakerHalfOpenSuccessThreshold,
      maxRetryAttempts: sourceProvider?.maxRetryAttempts ?? null,
    },
    network: {
      proxyUrl: sourceProvider?.proxyUrl ?? "",
      proxyFallbackToDirect: sourceProvider?.proxyFallbackToDirect ?? false,
      firstByteTimeoutStreamingSeconds: (() => {
        const ms = sourceProvider?.firstByteTimeoutStreamingMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      })(),
      streamingIdleTimeoutSeconds: (() => {
        const ms = sourceProvider?.streamingIdleTimeoutMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      })(),
      requestTimeoutNonStreamingSeconds: (() => {
        const ms = sourceProvider?.requestTimeoutNonStreamingMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      })(),
    },
    mcp: {
      mcpPassthroughType: sourceProvider?.mcpPassthroughType ?? "none",
      mcpPassthroughUrl: sourceProvider?.mcpPassthroughUrl ?? "",
    },
    batch: { isEnabled: "no_change" },
    ui: {
      activeTab: "basic",
      activeSubTab: null,
      isPending: false,
      showFailureThresholdConfirm: false,
    },
  };
}

// Default initial state
const defaultInitialState: ProviderFormState = createInitialState("create");

// Reducer function
export function providerFormReducer(
  state: ProviderFormState,
  action: ProviderFormAction
): ProviderFormState {
  switch (action.type) {
    // Basic info
    case "SET_NAME":
      return { ...state, basic: { ...state.basic, name: action.payload } };
    case "SET_URL":
      return { ...state, basic: { ...state.basic, url: action.payload } };
    case "SET_KEY":
      return { ...state, basic: { ...state.basic, key: action.payload } };
    case "SET_WEBSITE_URL":
      return { ...state, basic: { ...state.basic, websiteUrl: action.payload } };

    // Routing
    case "SET_PROVIDER_TYPE":
      return { ...state, routing: { ...state.routing, providerType: action.payload } };
    case "SET_GROUP_TAG":
      return { ...state, routing: { ...state.routing, groupTag: action.payload } };
    case "SET_PRESERVE_CLIENT_IP":
      return { ...state, routing: { ...state.routing, preserveClientIp: action.payload } };
    case "SET_DISABLE_SESSION_REUSE":
      return { ...state, routing: { ...state.routing, disableSessionReuse: action.payload } };
    case "SET_MODEL_REDIRECTS":
      return { ...state, routing: { ...state.routing, modelRedirects: action.payload } };
    case "SET_ALLOWED_MODELS":
      return { ...state, routing: { ...state.routing, allowedModels: action.payload } };
    case "SET_ALLOWED_CLIENTS":
      return { ...state, routing: { ...state.routing, allowedClients: action.payload } };
    case "SET_BLOCKED_CLIENTS":
      return { ...state, routing: { ...state.routing, blockedClients: action.payload } };
    case "SET_PRIORITY":
      return { ...state, routing: { ...state.routing, priority: action.payload } };
    case "SET_GROUP_PRIORITIES":
      return { ...state, routing: { ...state.routing, groupPriorities: action.payload } };
    case "SET_WEIGHT":
      return { ...state, routing: { ...state.routing, weight: action.payload } };
    case "SET_COST_MULTIPLIER":
      return { ...state, routing: { ...state.routing, costMultiplier: action.payload } };
    case "SET_CACHE_TTL_PREFERENCE":
      return { ...state, routing: { ...state.routing, cacheTtlPreference: action.payload } };
    case "SET_SWAP_CACHE_TTL_BILLING":
      return { ...state, routing: { ...state.routing, swapCacheTtlBilling: action.payload } };
    case "SET_CODEX_REASONING_EFFORT":
      return {
        ...state,
        routing: { ...state.routing, codexReasoningEffortPreference: action.payload },
      };
    case "SET_CODEX_REASONING_SUMMARY":
      return {
        ...state,
        routing: { ...state.routing, codexReasoningSummaryPreference: action.payload },
      };
    case "SET_CODEX_TEXT_VERBOSITY":
      return {
        ...state,
        routing: { ...state.routing, codexTextVerbosityPreference: action.payload },
      };
    case "SET_CODEX_PARALLEL_TOOL_CALLS":
      return {
        ...state,
        routing: { ...state.routing, codexParallelToolCallsPreference: action.payload },
      };
    case "SET_CODEX_SERVICE_TIER":
      return {
        ...state,
        routing: { ...state.routing, codexServiceTierPreference: action.payload },
      };
    case "SET_ANTHROPIC_MAX_TOKENS":
      return {
        ...state,
        routing: { ...state.routing, anthropicMaxTokensPreference: action.payload },
      };
    case "SET_ANTHROPIC_THINKING_BUDGET":
      return {
        ...state,
        routing: {
          ...state.routing,
          anthropicThinkingBudgetPreference: action.payload,
        },
      };
    case "SET_ADAPTIVE_THINKING_ENABLED":
      if (action.payload) {
        return {
          ...state,
          routing: {
            ...state.routing,
            anthropicAdaptiveThinking: state.routing.anthropicAdaptiveThinking ?? {
              effort: "high",
              modelMatchMode: "specific",
              models: ["claude-opus-4-6"],
            },
          },
        };
      }
      return {
        ...state,
        routing: {
          ...state.routing,
          anthropicAdaptiveThinking: null,
        },
      };
    case "SET_ADAPTIVE_THINKING_EFFORT":
      return {
        ...state,
        routing: {
          ...state.routing,
          anthropicAdaptiveThinking: state.routing.anthropicAdaptiveThinking
            ? { ...state.routing.anthropicAdaptiveThinking, effort: action.payload }
            : null,
        },
      };
    case "SET_ADAPTIVE_THINKING_MODEL_MATCH_MODE":
      return {
        ...state,
        routing: {
          ...state.routing,
          anthropicAdaptiveThinking: state.routing.anthropicAdaptiveThinking
            ? { ...state.routing.anthropicAdaptiveThinking, modelMatchMode: action.payload }
            : null,
        },
      };
    case "SET_ADAPTIVE_THINKING_MODELS":
      return {
        ...state,
        routing: {
          ...state.routing,
          anthropicAdaptiveThinking: state.routing.anthropicAdaptiveThinking
            ? { ...state.routing.anthropicAdaptiveThinking, models: action.payload }
            : null,
        },
      };
    case "SET_GEMINI_GOOGLE_SEARCH":
      return {
        ...state,
        routing: { ...state.routing, geminiGoogleSearchPreference: action.payload },
      };
    case "SET_ACTIVE_TIME_START":
      return {
        ...state,
        routing: { ...state.routing, activeTimeStart: action.payload },
      };
    case "SET_ACTIVE_TIME_END":
      return {
        ...state,
        routing: { ...state.routing, activeTimeEnd: action.payload },
      };

    // Rate limit
    case "SET_LIMIT_5H_USD":
      return { ...state, rateLimit: { ...state.rateLimit, limit5hUsd: action.payload } };
    case "SET_LIMIT_DAILY_USD":
      return { ...state, rateLimit: { ...state.rateLimit, limitDailyUsd: action.payload } };
    case "SET_DAILY_RESET_MODE":
      return { ...state, rateLimit: { ...state.rateLimit, dailyResetMode: action.payload } };
    case "SET_DAILY_RESET_TIME":
      return { ...state, rateLimit: { ...state.rateLimit, dailyResetTime: action.payload } };
    case "SET_LIMIT_WEEKLY_USD":
      return { ...state, rateLimit: { ...state.rateLimit, limitWeeklyUsd: action.payload } };
    case "SET_LIMIT_MONTHLY_USD":
      return { ...state, rateLimit: { ...state.rateLimit, limitMonthlyUsd: action.payload } };
    case "SET_LIMIT_TOTAL_USD":
      return { ...state, rateLimit: { ...state.rateLimit, limitTotalUsd: action.payload } };
    case "SET_LIMIT_CONCURRENT_SESSIONS":
      return {
        ...state,
        rateLimit: { ...state.rateLimit, limitConcurrentSessions: action.payload },
      };

    // Circuit breaker
    case "SET_FAILURE_THRESHOLD":
      return {
        ...state,
        circuitBreaker: { ...state.circuitBreaker, failureThreshold: action.payload },
      };
    case "SET_OPEN_DURATION_MINUTES":
      return {
        ...state,
        circuitBreaker: { ...state.circuitBreaker, openDurationMinutes: action.payload },
      };
    case "SET_HALF_OPEN_SUCCESS_THRESHOLD":
      return {
        ...state,
        circuitBreaker: { ...state.circuitBreaker, halfOpenSuccessThreshold: action.payload },
      };
    case "SET_MAX_RETRY_ATTEMPTS":
      return {
        ...state,
        circuitBreaker: { ...state.circuitBreaker, maxRetryAttempts: action.payload },
      };

    // Network
    case "SET_PROXY_URL":
      return { ...state, network: { ...state.network, proxyUrl: action.payload } };
    case "SET_PROXY_FALLBACK_TO_DIRECT":
      return { ...state, network: { ...state.network, proxyFallbackToDirect: action.payload } };
    case "SET_FIRST_BYTE_TIMEOUT_STREAMING":
      return {
        ...state,
        network: { ...state.network, firstByteTimeoutStreamingSeconds: action.payload },
      };
    case "SET_STREAMING_IDLE_TIMEOUT":
      return {
        ...state,
        network: { ...state.network, streamingIdleTimeoutSeconds: action.payload },
      };
    case "SET_REQUEST_TIMEOUT_NON_STREAMING":
      return {
        ...state,
        network: { ...state.network, requestTimeoutNonStreamingSeconds: action.payload },
      };

    // MCP
    case "SET_MCP_PASSTHROUGH_TYPE":
      return { ...state, mcp: { ...state.mcp, mcpPassthroughType: action.payload } };
    case "SET_MCP_PASSTHROUGH_URL":
      return { ...state, mcp: { ...state.mcp, mcpPassthroughUrl: action.payload } };

    // Batch
    case "SET_BATCH_IS_ENABLED":
      return { ...state, batch: { ...state.batch, isEnabled: action.payload } };

    // UI
    case "SET_ACTIVE_TAB":
      return { ...state, ui: { ...state.ui, activeTab: action.payload, activeSubTab: null } };
    case "SET_ACTIVE_NAV":
      return {
        ...state,
        ui: { ...state.ui, activeTab: action.payload.tab, activeSubTab: action.payload.subTab },
      };
    case "SET_IS_PENDING":
      return { ...state, ui: { ...state.ui, isPending: action.payload } };
    case "SET_SHOW_FAILURE_THRESHOLD_CONFIRM":
      return { ...state, ui: { ...state.ui, showFailureThresholdConfirm: action.payload } };

    // Reset
    case "RESET_FORM": {
      const fresh = structuredClone(defaultInitialState);
      return {
        ...fresh,
        ui: { ...fresh.ui, activeTab: state.ui.activeTab },
      };
    }

    // Load provider data
    case "LOAD_PROVIDER":
      return createInitialState("edit", action.payload);

    default:
      return state;
  }
}

// Context
const ProviderFormContext = createContext<ProviderFormContextValue | null>(null);

// Provider component
export function ProviderFormProvider({
  children,
  mode,
  provider,
  cloneProvider,
  enableMultiProviderTypes,
  hideUrl = false,
  hideWebsiteUrl = false,
  preset,
  groupSuggestions,
  batchProviders,
}: {
  children: ReactNode;
  mode: FormMode;
  provider?: ProviderDisplay;
  cloneProvider?: ProviderDisplay;
  enableMultiProviderTypes: boolean;
  hideUrl?: boolean;
  hideWebsiteUrl?: boolean;
  preset?: {
    name?: string;
    url?: string;
    websiteUrl?: string;
    providerType?: ProviderType;
  };
  groupSuggestions: string[];
  batchProviders?: ProviderDisplay[];
}) {
  const [state, rawDispatch] = useReducer(
    providerFormReducer,
    createInitialState(mode, provider, cloneProvider, preset, batchProviders)
  );

  const dirtyFieldsRef = useRef(new Set<string>());
  const isBatch = mode === "batch";

  // Compute batch analysis once if in batch mode
  const batchAnalysis = useMemo(() => {
    if (isBatch && batchProviders && batchProviders.length > 0) {
      return analyzeBatchProviderSettings(batchProviders);
    }
    return undefined;
  }, [isBatch, batchProviders]);

  // Wrap dispatch for batch mode to auto-track dirty fields
  const dispatch: Dispatch<ProviderFormAction> = useCallback(
    (action: ProviderFormAction) => {
      if (isBatch) {
        const fieldPath = ACTION_TO_FIELD_PATH[action.type];
        if (fieldPath) {
          dirtyFieldsRef.current.add(fieldPath);
        }
      }
      rawDispatch(action);
    },
    [isBatch]
  );

  const contextValue = useMemo<ProviderFormContextValue>(
    () => ({
      state,
      dispatch,
      mode,
      provider,
      enableMultiProviderTypes,
      hideUrl,
      hideWebsiteUrl,
      groupSuggestions,
      batchProviders,
      dirtyFields: dirtyFieldsRef.current,
      batchAnalysis,
    }),
    [
      state,
      dispatch,
      mode,
      provider,
      enableMultiProviderTypes,
      hideUrl,
      hideWebsiteUrl,
      groupSuggestions,
      batchProviders,
      batchAnalysis,
    ]
  );

  return (
    <ProviderFormContext.Provider value={contextValue}>{children}</ProviderFormContext.Provider>
  );
}

// Hook
export function useProviderForm(): ProviderFormContextValue {
  const context = useContext(ProviderFormContext);
  if (!context) {
    throw new Error("useProviderForm must be used within a ProviderFormProvider");
  }
  return context;
}
