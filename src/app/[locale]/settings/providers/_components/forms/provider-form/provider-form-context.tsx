"use client";

import { createContext, type ReactNode, useContext, useReducer } from "react";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import type {
  FormMode,
  ProviderFormAction,
  ProviderFormContextValue,
  ProviderFormState,
} from "./provider-form-types";

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
  }
): ProviderFormState {
  const isEdit = mode === "edit";
  const sourceProvider = isEdit ? provider : cloneProvider;

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
      groupTag: sourceProvider?.groupTag
        ? sourceProvider.groupTag
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      preserveClientIp: sourceProvider?.preserveClientIp ?? false,
      modelRedirects: sourceProvider?.modelRedirects ?? {},
      allowedModels: sourceProvider?.allowedModels ?? [],
      joinClaudePool: sourceProvider?.joinClaudePool ?? false,
      priority: sourceProvider?.priority ?? 0,
      weight: sourceProvider?.weight ?? 1,
      costMultiplier: sourceProvider?.costMultiplier ?? 1.0,
      cacheTtlPreference: sourceProvider?.cacheTtlPreference ?? "inherit",
      context1mPreference:
        (sourceProvider?.context1mPreference as "inherit" | "force_enable" | "disabled") ??
        "inherit",
      codexReasoningEffortPreference: sourceProvider?.codexReasoningEffortPreference ?? "inherit",
      codexReasoningSummaryPreference: sourceProvider?.codexReasoningSummaryPreference ?? "inherit",
      codexTextVerbosityPreference: sourceProvider?.codexTextVerbosityPreference ?? "inherit",
      codexParallelToolCallsPreference:
        sourceProvider?.codexParallelToolCallsPreference ?? "inherit",
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
    ui: {
      activeTab: "basic",
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
    case "SET_MODEL_REDIRECTS":
      return { ...state, routing: { ...state.routing, modelRedirects: action.payload } };
    case "SET_ALLOWED_MODELS":
      return { ...state, routing: { ...state.routing, allowedModels: action.payload } };
    case "SET_JOIN_CLAUDE_POOL":
      return { ...state, routing: { ...state.routing, joinClaudePool: action.payload } };
    case "SET_PRIORITY":
      return { ...state, routing: { ...state.routing, priority: action.payload } };
    case "SET_WEIGHT":
      return { ...state, routing: { ...state.routing, weight: action.payload } };
    case "SET_COST_MULTIPLIER":
      return { ...state, routing: { ...state.routing, costMultiplier: action.payload } };
    case "SET_CACHE_TTL_PREFERENCE":
      return { ...state, routing: { ...state.routing, cacheTtlPreference: action.payload } };
    case "SET_CONTEXT_1M_PREFERENCE":
      return { ...state, routing: { ...state.routing, context1mPreference: action.payload } };
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

    // UI
    case "SET_ACTIVE_TAB":
      return { ...state, ui: { ...state.ui, activeTab: action.payload } };
    case "SET_IS_PENDING":
      return { ...state, ui: { ...state.ui, isPending: action.payload } };
    case "SET_SHOW_FAILURE_THRESHOLD_CONFIRM":
      return { ...state, ui: { ...state.ui, showFailureThresholdConfirm: action.payload } };

    // Reset
    case "RESET_FORM":
      return {
        ...defaultInitialState,
        ui: { ...defaultInitialState.ui, activeTab: state.ui.activeTab },
      };

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
}) {
  const [state, dispatch] = useReducer(
    providerFormReducer,
    createInitialState(mode, provider, cloneProvider, preset)
  );

  return (
    <ProviderFormContext.Provider
      value={{
        state,
        dispatch,
        mode,
        provider,
        enableMultiProviderTypes,
        hideUrl,
        hideWebsiteUrl,
        groupSuggestions,
      }}
    >
      {children}
    </ProviderFormContext.Provider>
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
