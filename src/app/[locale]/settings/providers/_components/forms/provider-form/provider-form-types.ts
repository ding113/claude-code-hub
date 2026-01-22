import type { Dispatch } from "react";
import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexTextVerbosityPreference,
  McpPassthroughType,
  ProviderDisplay,
  ProviderType,
} from "@/types/provider";

// Form mode
export type FormMode = "create" | "edit";

// Tab identifiers
export type TabId = "basic" | "routing" | "limits" | "network" | "testing";

// Tab configuration
export interface TabConfig {
  id: TabId;
  labelKey: string;
  icon: string;
}

// Form state sections
export interface BasicInfoState {
  name: string;
  url: string;
  key: string;
  websiteUrl: string;
}

export interface RoutingState {
  providerType: ProviderType;
  groupTag: string[];
  preserveClientIp: boolean;
  modelRedirects: Record<string, string>;
  allowedModels: string[];
  joinClaudePool: boolean;
  priority: number;
  weight: number;
  costMultiplier: number;
  cacheTtlPreference: "inherit" | "5m" | "1h";
  context1mPreference: "inherit" | "force_enable" | "disabled";
  // Codex-specific
  codexReasoningEffortPreference: CodexReasoningEffortPreference;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference;
  codexTextVerbosityPreference: CodexTextVerbosityPreference;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference;
}

export interface RateLimitState {
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number | null;
}

export interface CircuitBreakerState {
  failureThreshold: number | undefined;
  openDurationMinutes: number | undefined;
  halfOpenSuccessThreshold: number | undefined;
  maxRetryAttempts: number | null;
}

export interface NetworkState {
  proxyUrl: string;
  proxyFallbackToDirect: boolean;
  firstByteTimeoutStreamingSeconds: number | undefined;
  streamingIdleTimeoutSeconds: number | undefined;
  requestTimeoutNonStreamingSeconds: number | undefined;
}

export interface McpState {
  mcpPassthroughType: McpPassthroughType;
  mcpPassthroughUrl: string;
}

export interface UIState {
  activeTab: TabId;
  isPending: boolean;
  showFailureThresholdConfirm: boolean;
}

// Complete form state
export interface ProviderFormState {
  basic: BasicInfoState;
  routing: RoutingState;
  rateLimit: RateLimitState;
  circuitBreaker: CircuitBreakerState;
  network: NetworkState;
  mcp: McpState;
  ui: UIState;
}

// Action types for reducer
export type ProviderFormAction =
  // Basic info actions
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_URL"; payload: string }
  | { type: "SET_KEY"; payload: string }
  | { type: "SET_WEBSITE_URL"; payload: string }
  // Routing actions
  | { type: "SET_PROVIDER_TYPE"; payload: ProviderType }
  | { type: "SET_GROUP_TAG"; payload: string[] }
  | { type: "SET_PRESERVE_CLIENT_IP"; payload: boolean }
  | { type: "SET_MODEL_REDIRECTS"; payload: Record<string, string> }
  | { type: "SET_ALLOWED_MODELS"; payload: string[] }
  | { type: "SET_JOIN_CLAUDE_POOL"; payload: boolean }
  | { type: "SET_PRIORITY"; payload: number }
  | { type: "SET_WEIGHT"; payload: number }
  | { type: "SET_COST_MULTIPLIER"; payload: number }
  | { type: "SET_CACHE_TTL_PREFERENCE"; payload: "inherit" | "5m" | "1h" }
  | { type: "SET_CONTEXT_1M_PREFERENCE"; payload: "inherit" | "force_enable" | "disabled" }
  | { type: "SET_CODEX_REASONING_EFFORT"; payload: CodexReasoningEffortPreference }
  | { type: "SET_CODEX_REASONING_SUMMARY"; payload: CodexReasoningSummaryPreference }
  | { type: "SET_CODEX_TEXT_VERBOSITY"; payload: CodexTextVerbosityPreference }
  | { type: "SET_CODEX_PARALLEL_TOOL_CALLS"; payload: CodexParallelToolCallsPreference }
  // Rate limit actions
  | { type: "SET_LIMIT_5H_USD"; payload: number | null }
  | { type: "SET_LIMIT_DAILY_USD"; payload: number | null }
  | { type: "SET_DAILY_RESET_MODE"; payload: "fixed" | "rolling" }
  | { type: "SET_DAILY_RESET_TIME"; payload: string }
  | { type: "SET_LIMIT_WEEKLY_USD"; payload: number | null }
  | { type: "SET_LIMIT_MONTHLY_USD"; payload: number | null }
  | { type: "SET_LIMIT_TOTAL_USD"; payload: number | null }
  | { type: "SET_LIMIT_CONCURRENT_SESSIONS"; payload: number | null }
  // Circuit breaker actions
  | { type: "SET_FAILURE_THRESHOLD"; payload: number | undefined }
  | { type: "SET_OPEN_DURATION_MINUTES"; payload: number | undefined }
  | { type: "SET_HALF_OPEN_SUCCESS_THRESHOLD"; payload: number | undefined }
  | { type: "SET_MAX_RETRY_ATTEMPTS"; payload: number | null }
  // Network actions
  | { type: "SET_PROXY_URL"; payload: string }
  | { type: "SET_PROXY_FALLBACK_TO_DIRECT"; payload: boolean }
  | { type: "SET_FIRST_BYTE_TIMEOUT_STREAMING"; payload: number | undefined }
  | { type: "SET_STREAMING_IDLE_TIMEOUT"; payload: number | undefined }
  | { type: "SET_REQUEST_TIMEOUT_NON_STREAMING"; payload: number | undefined }
  // MCP actions
  | { type: "SET_MCP_PASSTHROUGH_TYPE"; payload: McpPassthroughType }
  | { type: "SET_MCP_PASSTHROUGH_URL"; payload: string }
  // UI actions
  | { type: "SET_ACTIVE_TAB"; payload: TabId }
  | { type: "SET_IS_PENDING"; payload: boolean }
  | { type: "SET_SHOW_FAILURE_THRESHOLD_CONFIRM"; payload: boolean }
  // Bulk actions
  | { type: "RESET_FORM" }
  | { type: "LOAD_PROVIDER"; payload: ProviderDisplay };

// Form props
export interface ProviderFormProps {
  mode: FormMode;
  onSuccess?: () => void;
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
  urlResolver?: (providerType: ProviderType) => Promise<string | null>;
  allowedProviderTypes?: ProviderType[];
}

// Context value
export interface ProviderFormContextValue {
  state: ProviderFormState;
  dispatch: Dispatch<ProviderFormAction>;
  mode: FormMode;
  provider?: ProviderDisplay;
  enableMultiProviderTypes: boolean;
  hideUrl: boolean;
  hideWebsiteUrl: boolean;
  groupSuggestions: string[];
}
