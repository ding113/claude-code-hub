import type { Numeric } from "decimal.js-light";

/**
 * 供应商信息（用于决策链）
 * 记录详细的选择决策过程和上下文
 */
export interface ProviderChainItem {
  id: number;
  name: string;

  // === 选择原因（细化） ===
  reason?:
    | "session_reuse" // 会话复用
    | "initial_selection" // 首次选择（成功）
    | "concurrent_limit_failed" // 并发限制失败
    | "request_success" // 修复：请求成功（首次）
    | "retry_success" // 重试成功
    | "retry_failed" // 重试失败（供应商错误，已计入熔断器）
    | "system_error" // 系统/网络错误（不计入熔断器）
    | "retry_with_official_instructions" // Codex instructions 自动重试（官方）
    | "retry_with_cached_instructions" // Codex instructions 智能重试（缓存）
    | "client_error_non_retryable" // 不可重试的客户端错误（Prompt 超限、内容过滤、PDF 限制、Thinking 格式）
    | "http2_fallback"; // HTTP/2 协议错误，回退到 HTTP/1.1（不切换供应商、不计入熔断器）

  // === 选择方法（细化） ===
  selectionMethod?:
    | "session_reuse" // 会话复用
    | "weighted_random" // 加权随机
    | "group_filtered" // 分组筛选后随机
    | "fail_open_fallback"; // Fail Open 降级

  // 供应商配置（决策依据）
  priority?: number;
  weight?: number;
  costMultiplier?: number;
  groupTag?: string | null;

  // 健康状态快照
  circuitState?: "closed" | "open" | "half-open";

  // 修复：新增熔断计数信息（用于显示距离熔断还有多少次）
  circuitFailureCount?: number; // 失败计数（包含本次失败）
  circuitFailureThreshold?: number; // 熔断阈值

  // 时间戳和尝试信息
  timestamp?: number;
  attemptNumber?: number; // 第几次尝试（用于标识重试）

  // 修复：新增成功时的状态码
  statusCode?: number;

  // 模型重定向信息（在供应商级别记录）
  modelRedirect?: {
    originalModel: string; // 用户请求的模型（计费依据）
    redirectedModel: string; // 实际转发的模型
    billingModel: string; // 计费模型（通常等于 originalModel）
  };

  // 错误信息（记录失败时的上游报错）
  errorMessage?: string;

  // 结构化错误详情（便于格式化显示）
  errorDetails?: {
    // 供应商错误（HTTP 4xx/5xx）
    provider?: {
      id: number;
      name: string;
      statusCode: number;
      statusText: string; // 如 "Internal Server Error"
      upstreamBody?: string; // 原始响应体
      upstreamParsed?: unknown; // 解析后的 JSON
    };

    // Codex Instructions 重试来源（用于智能重试）
    instructionsSource?: "cache" | "official";

    // 系统/网络错误（fetch 异常）
    system?: {
      errorType: string; // 如 "TypeError"
      errorName: string; // 如 "fetch failed"
      errorCode?: string; // 如 "ENOTFOUND"
      errorSyscall?: string; // 如 "getaddrinfo"
      errorStack?: string; // 堆栈前3行
    };

    // 客户端输入错误（不可重试）
    clientError?: string; // 详细的客户端错误消息（包含匹配的白名单模式）
  };

  // === 决策上下文（完整记录） ===
  decisionContext?: {
    // --- 供应商池状态 ---
    totalProviders: number; // 系统总供应商数
    enabledProviders: number; // 启用的供应商数
    targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli"; // 目标类型（基于请求格式推断）
    requestedModel?: string; // 请求的模型名称（用于追踪）

    // --- 用户分组筛选 ---
    userGroup?: string; // 用户分组（如果有）
    afterGroupFilter?: number; // 分组筛选后数量
    groupFilterApplied: boolean; // 是否应用了分组筛选

    // --- 模型白名单过滤 ---
    afterModelFilter?: number; // 模型白名单筛选后数量

    // --- 健康检查过滤 ---
    beforeHealthCheck: number; // 健康检查前数量
    afterHealthCheck: number; // 健康检查后数量
    filteredProviders?: Array<{
      // 被过滤的供应商
      id: number;
      name: string;
      reason:
        | "circuit_open"
        | "rate_limited"
        | "excluded"
        | "format_type_mismatch" // 请求格式与供应商类型不兼容
        | "type_mismatch"
        | "model_not_allowed"
        | "disabled";
      details?: string; // 额外信息（如费用：$15.2/$15）
    }>;

    // --- 优先级分层 ---
    priorityLevels: number[]; // 所有优先级值（降序）
    selectedPriority: number; // 选定的最高优先级
    candidatesAtPriority: Array<{
      // 该优先级的候选列表
      id: number;
      name: string;
      weight: number;
      costMultiplier: number;
      probability?: number; // 被选中的概率（加权后）
    }>;

    // --- 会话复用特有 ---
    sessionId?: string; // 复用的 session ID
    sessionAge?: number; // 会话年龄（秒）

    // --- 并发限制特有 ---
    concurrentLimit?: number; // 并发限制
    currentConcurrent?: number; // 当前并发数

    // --- 重试特有 ---
    excludedProviderIds?: number[]; // 已排除的供应商 ID 列表
    retryReason?: string; // 重试原因
  };
}

/**
 * 消息请求数据库实体类型
 */
export interface MessageRequest {
  id: number;
  providerId: number;
  userId: number;
  key: string;
  model?: string;
  durationMs?: number;
  costUsd?: string; // 单次请求费用（美元），保持高精度字符串表示

  // 供应商倍率（记录该请求使用的 cost_multiplier）
  costMultiplier?: number;

  // Session ID（用于会话粘性和日志追踪）
  sessionId?: string;

  // 上游决策链（记录尝试的供应商列表）
  providerChain?: ProviderChainItem[];

  // HTTP 状态码
  statusCode?: number;

  // 模型重定向：原始模型名称（用户请求的模型）
  originalModel?: string;

  // Token 使用信息
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;

  // 错误信息
  errorMessage?: string;

  // User-Agent（用于客户端类型分析）
  userAgent?: string;

  // 请求的 API endpoint（例如：/v1/messages），从 URL.pathname 提取
  endpoint?: string;

  // Messages 数量（用于短请求检测和分析）
  messagesCount?: number;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

/**
 * 创建消息请求数据
 */
export interface CreateMessageRequestData {
  provider_id: number;
  user_id: number;
  key: string;
  model?: string;
  duration_ms?: number;
  cost_usd?: Numeric; // 单次请求费用（美元），支持高精度

  // 供应商倍率（记录该请求使用的 cost_multiplier）
  cost_multiplier?: number;

  // Session ID（用于会话粘性和日志追踪）
  session_id?: string;

  // 上游决策链
  provider_chain?: ProviderChainItem[];

  // HTTP 状态码
  status_code?: number;

  // 模型重定向：原始模型名称（用户请求的模型）
  original_model?: string;

  // Token 使用信息
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;

  // 错误信息
  error_message?: string;

  // User-Agent（用于客户端类型分析）
  user_agent?: string;

  // 请求的 API endpoint（例如：/v1/messages），从 URL.pathname 提取
  endpoint?: string;

  // Messages 数量（用于短请求检测和分析）
  messages_count?: number;
}

/**
 * SSE 解析后的事件数据
 */
export interface ParsedSSEEvent {
  event: string;
  data: Record<string, unknown> | string;
}
