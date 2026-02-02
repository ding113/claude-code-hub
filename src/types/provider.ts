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
  costMultiplier: number;
  groupTag: string | null;

  // 供应商类型：扩展支持 4 种类型
  providerType: ProviderType;
  // 是否透传客户端 IP
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;

  // 模型列表：双重语义
  // - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
  // - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
  // - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
  allowedModels: string[] | null;

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
  costMultiplier: number;
  groupTag: string | null;
  // 供应商类型
  providerType: ProviderType;
  // 供应商聚合实体（按官网域名归一）
  providerVendorId: number | null;
  // 是否透传客户端 IP
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;
  // 模型列表（双重语义）
  allowedModels: string[] | null;
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
  context1mPreference: Context1mPreference | null;
  codexReasoningEffortPreference: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference | null;
  anthropicMaxTokensPreference: AnthropicMaxTokensPreference | null;
  anthropicThinkingBudgetPreference: AnthropicThinkingBudgetPreference | null;
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
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  preserve_client_ip?: boolean;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
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
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  anthropic_max_tokens_preference?: AnthropicMaxTokensPreference | null;
  anthropic_thinking_budget_preference?: AnthropicThinkingBudgetPreference | null;

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
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  preserve_client_ip?: boolean;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
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
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  anthropic_max_tokens_preference?: AnthropicMaxTokensPreference | null;
  anthropic_thinking_budget_preference?: AnthropicThinkingBudgetPreference | null;

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
