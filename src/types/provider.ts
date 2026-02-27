// 供应商类型枚举

import type { Context1mPreference } from "@/lib/special-attributes";
import type { CacheTtlPreference } from "./cache";

export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";

// Codex（Responses API）请求参数覆写偏好
// - "inherit": 遵循客户端请求（默认）
// - 其他值: 强制覆写请求体字段
export type CodexReasoningEffortPreference =
  | "inherit"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type CodexReasoningSummaryPreference = "inherit" | "auto" | "detailed";

export type CodexTextVerbosityPreference = "inherit" | "low" | "medium" | "high";

// 由于 Select 的 value 需要是字符串，这里用 "true"/"false" 表示布尔值
export type CodexParallelToolCallsPreference = "inherit" | "true" | "false";

// Anthropic (Messages API) parameter overrides
// - "inherit": follow client request (default)
// - numeric string: force override to that value
export type AnthropicMaxTokensPreference = "inherit" | string;
export type AnthropicThinkingBudgetPreference = "inherit" | string;

// Anthropic adaptive thinking configuration
export type AnthropicAdaptiveThinkingEffort = "low" | "medium" | "high" | "max";
export type AnthropicAdaptiveThinkingModelMatchMode = "specific" | "all";
export interface AnthropicAdaptiveThinkingConfig {
  effort: AnthropicAdaptiveThinkingEffort;
  modelMatchMode: AnthropicAdaptiveThinkingModelMatchMode;
  models: string[];
}

export type ProviderPatchOperation<T> =
  | { mode: "no_change" }
  | { mode: "set"; value: T }
  | { mode: "clear" };

export type ProviderPatchDraftInput<T> =
  | { set: T; clear?: never; no_change?: never }
  | { clear: true; set?: never; no_change?: never }
  | { no_change: true; set?: never; clear?: never }
  | undefined;

export type ProviderBatchPatchField =
  // Basic / existing
  | "is_enabled"
  | "priority"
  | "weight"
  | "cost_multiplier"
  | "group_tag"
  | "model_redirects"
  | "allowed_models"
  | "allowed_clients"
  | "blocked_clients"
  | "anthropic_thinking_budget_preference"
  | "anthropic_adaptive_thinking"
  // Routing / Schedule
  | "active_time_start"
  | "active_time_end"
  | "preserve_client_ip"
  | "group_priorities"
  | "cache_ttl_preference"
  | "swap_cache_ttl_billing"
  | "context_1m_preference"
  | "codex_reasoning_effort_preference"
  | "codex_reasoning_summary_preference"
  | "codex_text_verbosity_preference"
  | "codex_parallel_tool_calls_preference"
  | "anthropic_max_tokens_preference"
  | "gemini_google_search_preference"
  // Rate Limit
  | "limit_5h_usd"
  | "limit_daily_usd"
  | "daily_reset_mode"
  | "daily_reset_time"
  | "limit_weekly_usd"
  | "limit_monthly_usd"
  | "limit_total_usd"
  | "limit_concurrent_sessions"
  // Circuit Breaker
  | "circuit_breaker_failure_threshold"
  | "circuit_breaker_open_duration"
  | "circuit_breaker_half_open_success_threshold"
  | "max_retry_attempts"
  // Network
  | "proxy_url"
  | "proxy_fallback_to_direct"
  | "first_byte_timeout_streaming_ms"
  | "streaming_idle_timeout_ms"
  | "request_timeout_non_streaming_ms"
  // MCP
  | "mcp_passthrough_type"
  | "mcp_passthrough_url";

export interface ProviderBatchPatchDraft {
  // Basic / existing
  is_enabled?: ProviderPatchDraftInput<boolean>;
  priority?: ProviderPatchDraftInput<number>;
  weight?: ProviderPatchDraftInput<number>;
  cost_multiplier?: ProviderPatchDraftInput<number>;
  group_tag?: ProviderPatchDraftInput<string>;
  model_redirects?: ProviderPatchDraftInput<Record<string, string>>;
  allowed_models?: ProviderPatchDraftInput<string[]>;
  allowed_clients?: ProviderPatchDraftInput<string[]>;
  blocked_clients?: ProviderPatchDraftInput<string[]>;
  anthropic_thinking_budget_preference?: ProviderPatchDraftInput<AnthropicThinkingBudgetPreference>;
  anthropic_adaptive_thinking?: ProviderPatchDraftInput<AnthropicAdaptiveThinkingConfig>;
  // Routing / Schedule
  active_time_start?: ProviderPatchDraftInput<string>;
  active_time_end?: ProviderPatchDraftInput<string>;
  preserve_client_ip?: ProviderPatchDraftInput<boolean>;
  group_priorities?: ProviderPatchDraftInput<Record<string, number>>;
  cache_ttl_preference?: ProviderPatchDraftInput<CacheTtlPreference>;
  swap_cache_ttl_billing?: ProviderPatchDraftInput<boolean>;
  context_1m_preference?: ProviderPatchDraftInput<Context1mPreference>;
  codex_reasoning_effort_preference?: ProviderPatchDraftInput<CodexReasoningEffortPreference>;
  codex_reasoning_summary_preference?: ProviderPatchDraftInput<CodexReasoningSummaryPreference>;
  codex_text_verbosity_preference?: ProviderPatchDraftInput<CodexTextVerbosityPreference>;
  codex_parallel_tool_calls_preference?: ProviderPatchDraftInput<CodexParallelToolCallsPreference>;
  anthropic_max_tokens_preference?: ProviderPatchDraftInput<AnthropicMaxTokensPreference>;
  gemini_google_search_preference?: ProviderPatchDraftInput<GeminiGoogleSearchPreference>;
  // Rate Limit
  limit_5h_usd?: ProviderPatchDraftInput<number>;
  limit_daily_usd?: ProviderPatchDraftInput<number>;
  daily_reset_mode?: ProviderPatchDraftInput<"fixed" | "rolling">;
  daily_reset_time?: ProviderPatchDraftInput<string>;
  limit_weekly_usd?: ProviderPatchDraftInput<number>;
  limit_monthly_usd?: ProviderPatchDraftInput<number>;
  limit_total_usd?: ProviderPatchDraftInput<number>;
  limit_concurrent_sessions?: ProviderPatchDraftInput<number>;
  // Circuit Breaker
  circuit_breaker_failure_threshold?: ProviderPatchDraftInput<number>;
  circuit_breaker_open_duration?: ProviderPatchDraftInput<number>;
  circuit_breaker_half_open_success_threshold?: ProviderPatchDraftInput<number>;
  max_retry_attempts?: ProviderPatchDraftInput<number>;
  // Network
  proxy_url?: ProviderPatchDraftInput<string>;
  proxy_fallback_to_direct?: ProviderPatchDraftInput<boolean>;
  first_byte_timeout_streaming_ms?: ProviderPatchDraftInput<number>;
  streaming_idle_timeout_ms?: ProviderPatchDraftInput<number>;
  request_timeout_non_streaming_ms?: ProviderPatchDraftInput<number>;
  // MCP
  mcp_passthrough_type?: ProviderPatchDraftInput<McpPassthroughType>;
  mcp_passthrough_url?: ProviderPatchDraftInput<string>;
}

export interface ProviderBatchPatch {
  // Basic / existing
  is_enabled: ProviderPatchOperation<boolean>;
  priority: ProviderPatchOperation<number>;
  weight: ProviderPatchOperation<number>;
  cost_multiplier: ProviderPatchOperation<number>;
  group_tag: ProviderPatchOperation<string>;
  model_redirects: ProviderPatchOperation<Record<string, string>>;
  allowed_models: ProviderPatchOperation<string[]>;
  allowed_clients: ProviderPatchOperation<string[]>;
  blocked_clients: ProviderPatchOperation<string[]>;
  anthropic_thinking_budget_preference: ProviderPatchOperation<AnthropicThinkingBudgetPreference>;
  anthropic_adaptive_thinking: ProviderPatchOperation<AnthropicAdaptiveThinkingConfig>;
  // Routing / Schedule
  active_time_start: ProviderPatchOperation<string>;
  active_time_end: ProviderPatchOperation<string>;
  preserve_client_ip: ProviderPatchOperation<boolean>;
  group_priorities: ProviderPatchOperation<Record<string, number>>;
  cache_ttl_preference: ProviderPatchOperation<CacheTtlPreference>;
  swap_cache_ttl_billing: ProviderPatchOperation<boolean>;
  context_1m_preference: ProviderPatchOperation<Context1mPreference>;
  codex_reasoning_effort_preference: ProviderPatchOperation<CodexReasoningEffortPreference>;
  codex_reasoning_summary_preference: ProviderPatchOperation<CodexReasoningSummaryPreference>;
  codex_text_verbosity_preference: ProviderPatchOperation<CodexTextVerbosityPreference>;
  codex_parallel_tool_calls_preference: ProviderPatchOperation<CodexParallelToolCallsPreference>;
  anthropic_max_tokens_preference: ProviderPatchOperation<AnthropicMaxTokensPreference>;
  gemini_google_search_preference: ProviderPatchOperation<GeminiGoogleSearchPreference>;
  // Rate Limit
  limit_5h_usd: ProviderPatchOperation<number>;
  limit_daily_usd: ProviderPatchOperation<number>;
  daily_reset_mode: ProviderPatchOperation<"fixed" | "rolling">;
  daily_reset_time: ProviderPatchOperation<string>;
  limit_weekly_usd: ProviderPatchOperation<number>;
  limit_monthly_usd: ProviderPatchOperation<number>;
  limit_total_usd: ProviderPatchOperation<number>;
  limit_concurrent_sessions: ProviderPatchOperation<number>;
  // Circuit Breaker
  circuit_breaker_failure_threshold: ProviderPatchOperation<number>;
  circuit_breaker_open_duration: ProviderPatchOperation<number>;
  circuit_breaker_half_open_success_threshold: ProviderPatchOperation<number>;
  max_retry_attempts: ProviderPatchOperation<number>;
  // Network
  proxy_url: ProviderPatchOperation<string>;
  proxy_fallback_to_direct: ProviderPatchOperation<boolean>;
  first_byte_timeout_streaming_ms: ProviderPatchOperation<number>;
  streaming_idle_timeout_ms: ProviderPatchOperation<number>;
  request_timeout_non_streaming_ms: ProviderPatchOperation<number>;
  // MCP
  mcp_passthrough_type: ProviderPatchOperation<McpPassthroughType>;
  mcp_passthrough_url: ProviderPatchOperation<string>;
}

export interface ProviderBatchApplyUpdates {
  // Basic / existing
  is_enabled?: boolean;
  priority?: number;
  weight?: number;
  cost_multiplier?: number;
  group_tag?: string | null;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  allowed_clients?: string[];
  blocked_clients?: string[];
  anthropic_thinking_budget_preference?: AnthropicThinkingBudgetPreference | null;
  anthropic_adaptive_thinking?: AnthropicAdaptiveThinkingConfig | null;
  // Routing / Schedule
  active_time_start?: string | null;
  active_time_end?: string | null;
  preserve_client_ip?: boolean;
  group_priorities?: Record<string, number> | null;
  cache_ttl_preference?: CacheTtlPreference | null;
  swap_cache_ttl_billing?: boolean;
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  anthropic_max_tokens_preference?: AnthropicMaxTokensPreference | null;
  gemini_google_search_preference?: GeminiGoogleSearchPreference | null;
  // Rate Limit
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number;
  // Circuit Breaker
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number;
  circuit_breaker_half_open_success_threshold?: number;
  max_retry_attempts?: number | null;
  // Network
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;
  first_byte_timeout_streaming_ms?: number;
  streaming_idle_timeout_ms?: number;
  request_timeout_non_streaming_ms?: number;
  // MCP
  mcp_passthrough_type?: McpPassthroughType;
  mcp_passthrough_url?: string | null;
}

// Gemini (generateContent API) parameter overrides
// - "inherit": follow client request (default)
// - "enabled": force inject googleSearch tool
// - "disabled": force remove googleSearch tool from request
export type GeminiGoogleSearchPreference = "inherit" | "enabled" | "disabled";

// MCP 透传类型枚举
export type McpPassthroughType = "none" | "minimax" | "glm" | "custom";

export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  // 供应商聚合实体（按官网域名归一）
  providerVendorId: number | null;
  // 是否启用
  isEnabled: boolean;
  // 权重（0-100）
  weight: number;

  // 优先级和分组配置
  priority: number;
  groupPriorities: Record<string, number> | null;
  costMultiplier: number;
  groupTag: string | null;

  // 供应商类型：扩展支持 4 种类型
  providerType: ProviderType;
  // 是否透传客户端 IP
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;

  // Scheduled active time window (HH:mm format, null = always active)
  activeTimeStart: string | null;
  activeTimeEnd: string | null;

  // 模型列表：双重语义
  // - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
  // - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
  // - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
  allowedModels: string[] | null;
  allowedClients: string[]; // Allowed client patterns (empty = no restriction)
  blockedClients: string[]; // Blocked client patterns (blacklist, checked before allowedClients)

  // MCP 透传类型：控制是否启用 MCP 透传功能
  // 'none': 不启用（默认）
  // 'minimax': 透传到 minimax MCP 服务（图片识别、联网搜索）
  // 'glm': 透传到智谱 MCP 服务（图片分析、视频分析）
  // 'custom': 自定义 MCP 服务（预留）
  mcpPassthroughType: McpPassthroughType;

  // MCP 透传 URL：MCP 服务的基础 URL
  // 如果未配置，则自动从 provider.url 提取基础域名
  // 例如：https://api.minimaxi.com/anthropic -> https://api.minimaxi.com
  mcpPassthroughUrl: string | null;

  // 金额限流配置
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  // 总消费上限（手动重置后从 0 重新累计）
  limitTotalUsd: number | null;
  // 总消费重置时间：用于实现“达到总限额后手动重置用量”
  totalCostResetAt: Date | null;
  limitConcurrentSessions: number;

  // 熔断器配置（每个供应商独立配置）
  maxRetryAttempts: number | null;
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number; // 毫秒
  circuitBreakerHalfOpenSuccessThreshold: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;

  // 超时配置（毫秒）
  firstByteTimeoutStreamingMs: number;
  streamingIdleTimeoutMs: number;
  requestTimeoutNonStreamingMs: number;

  // 供应商官网地址（用于快速跳转管理）
  websiteUrl: string | null;
  faviconUrl: string | null;

  // Cache TTL override（inherit 表示不强制覆写）
  cacheTtlPreference: CacheTtlPreference | null;

  // Cache TTL billing swap: invert 1h<->5m for cost calculation
  swapCacheTtlBilling: boolean;

  // 1M Context Window 偏好配置（仅对 Anthropic 类型供应商有效）
  context1mPreference: Context1mPreference | null;

  // Codex（Responses API）参数覆写（仅对 Codex 类型供应商有效）
  codexReasoningEffortPreference: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference | null;

  // Anthropic (Messages API) parameter overrides (only for claude/claude-auth providers)
  anthropicMaxTokensPreference: AnthropicMaxTokensPreference | null;
  anthropicThinkingBudgetPreference: AnthropicThinkingBudgetPreference | null;
  anthropicAdaptiveThinking: AnthropicAdaptiveThinkingConfig | null;

  // Gemini (generateContent API) parameter overrides (only for gemini/gemini-cli providers)
  geminiGoogleSearchPreference: GeminiGoogleSearchPreference | null;

  // 废弃（保留向后兼容，但不再使用）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc: number | null;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// 前端显示用的供应商类型（包含格式化后的数据）
export interface ProviderDisplay {
  id: number;
  name: string;
  url: string;
  maskedKey: string;
  isEnabled: boolean;
  weight: number;
  // 优先级和分组配置
  priority: number;
  groupPriorities: Record<string, number> | null;
  costMultiplier: number;
  groupTag: string | null;
  // 供应商类型
  providerType: ProviderType;
  // 供应商聚合实体（按官网域名归一）
  providerVendorId: number | null;
  // 是否透传客户端 IP
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;
  // Scheduled active time window
  activeTimeStart: string | null;
  activeTimeEnd: string | null;
  // 模型列表（双重语义）
  allowedModels: string[] | null;
  allowedClients: string[]; // Allowed client patterns (empty = no restriction)
  blockedClients: string[]; // Blocked client patterns (blacklist, checked before allowedClients)
  // MCP 透传类型
  mcpPassthroughType: McpPassthroughType;
  // MCP 透传 URL
  mcpPassthroughUrl: string | null;
  // 金额限流配置
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number;
  // 熔断器配置
  maxRetryAttempts: number | null;
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number; // 毫秒
  circuitBreakerHalfOpenSuccessThreshold: number;
  // 代理配置
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  // 超时配置（毫秒）
  firstByteTimeoutStreamingMs: number;
  streamingIdleTimeoutMs: number;
  requestTimeoutNonStreamingMs: number;
  // 供应商官网地址
  websiteUrl: string | null;
  faviconUrl: string | null;
  cacheTtlPreference: CacheTtlPreference | null;
  swapCacheTtlBilling: boolean;
  context1mPreference: Context1mPreference | null;
  codexReasoningEffortPreference: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference | null;
  anthropicMaxTokensPreference: AnthropicMaxTokensPreference | null;
  anthropicThinkingBudgetPreference: AnthropicThinkingBudgetPreference | null;
  anthropicAdaptiveThinking: AnthropicAdaptiveThinkingConfig | null;
  geminiGoogleSearchPreference: GeminiGoogleSearchPreference | null;
  // 废弃字段（保留向后兼容）
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
  createdAt: string; // 格式化后的日期字符串
  updatedAt: string; // 格式化后的日期字符串
  // 统计数据（可选）
  todayTotalCostUsd?: string;
  todayCallCount?: number;
  lastCallTime?: string | null;
  lastCallModel?: string | null;
}

/**
 * Provider statistics loaded asynchronously
 * Used by getProviderStatisticsAsync() return type
 */
export interface ProviderStatistics {
  todayCost: string;
  todayCalls: number;
  lastCallTime: string | null;
  lastCallModel: string | null;
}

/**
 * Map of provider ID to statistics
 */
export type ProviderStatisticsMap = Record<number, ProviderStatistics>;

export interface CreateProviderData {
  name: string;
  url: string;
  key: string;
  // 是否启用（默认 true）- 数据库字段名
  is_enabled?: boolean;
  // 权重（默认 1）
  weight?: number;

  // 优先级和分组配置
  priority?: number;
  group_priorities?: Record<string, number> | null;
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  preserve_client_ip?: boolean;
  model_redirects?: Record<string, string> | null;
  active_time_start?: string | null;
  active_time_end?: string | null;
  allowed_models?: string[] | null;
  allowed_clients?: string[] | null;
  blocked_clients?: string[] | null;
  mcp_passthrough_type?: McpPassthroughType;
  mcp_passthrough_url?: string | null;

  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number;

  // 熔断器配置
  max_retry_attempts?: number | null;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number; // 毫秒
  circuit_breaker_half_open_success_threshold?: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;

  // 超时配置（毫秒）
  first_byte_timeout_streaming_ms?: number;
  streaming_idle_timeout_ms?: number;
  request_timeout_non_streaming_ms?: number;

  // 供应商官网地址
  website_url?: string | null;
  favicon_url?: string | null;
  cache_ttl_preference?: CacheTtlPreference | null;
  swap_cache_ttl_billing?: boolean;
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  anthropic_max_tokens_preference?: AnthropicMaxTokensPreference | null;
  anthropic_thinking_budget_preference?: AnthropicThinkingBudgetPreference | null;
  anthropic_adaptive_thinking?: AnthropicAdaptiveThinkingConfig | null;
  gemini_google_search_preference?: GeminiGoogleSearchPreference | null;

  // 废弃字段（保留向后兼容）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc: number | null;
}

export interface UpdateProviderData {
  name?: string;
  url?: string;
  key?: string;
  // 是否启用 - 数据库字段名
  is_enabled?: boolean;
  // 权重（0-100）
  weight?: number;

  // 优先级和分组配置
  priority?: number;
  group_priorities?: Record<string, number> | null;
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  preserve_client_ip?: boolean;
  model_redirects?: Record<string, string> | null;
  active_time_start?: string | null;
  active_time_end?: string | null;
  allowed_models?: string[] | null;
  allowed_clients?: string[] | null;
  blocked_clients?: string[] | null;
  mcp_passthrough_type?: McpPassthroughType;
  mcp_passthrough_url?: string | null;

  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number;

  // 熔断器配置
  max_retry_attempts?: number | null;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number; // 毫秒
  circuit_breaker_half_open_success_threshold?: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;

  // 超时配置（毫秒）
  first_byte_timeout_streaming_ms?: number;
  streaming_idle_timeout_ms?: number;
  request_timeout_non_streaming_ms?: number;

  // 供应商官网地址
  website_url?: string | null;
  favicon_url?: string | null;
  cache_ttl_preference?: CacheTtlPreference | null;
  swap_cache_ttl_billing?: boolean;
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  anthropic_max_tokens_preference?: AnthropicMaxTokensPreference | null;
  anthropic_thinking_budget_preference?: AnthropicThinkingBudgetPreference | null;
  anthropic_adaptive_thinking?: AnthropicAdaptiveThinkingConfig | null;
  gemini_google_search_preference?: GeminiGoogleSearchPreference | null;

  // 废弃字段（保留向后兼容）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm?: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm?: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd?: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc?: number | null;
}

export interface ProviderVendor {
  id: number;
  websiteDomain: string;
  displayName: string | null;
  websiteUrl: string | null;
  faviconUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProviderEndpointProbeSource = "scheduled" | "manual" | "runtime";

export interface ProviderEndpoint {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label: string | null;
  sortOrder: number;
  isEnabled: boolean;
  lastProbedAt: Date | null;
  lastProbeOk: boolean | null;
  lastProbeStatusCode: number | null;
  lastProbeLatencyMs: number | null;
  lastProbeErrorType: string | null;
  lastProbeErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProviderEndpointProbeLog {
  id: number;
  endpointId: number;
  source: ProviderEndpointProbeSource;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: Date;
}
