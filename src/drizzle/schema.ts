import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { SpecialSetting } from '@/types/special-settings';
import type { ResponseFixerConfig } from '@/types/system-config';
import type { ProviderType } from "@/types/provider";

// Enums
export const dailyResetModeEnum = pgEnum('daily_reset_mode', ['fixed', 'rolling']);
export const webhookProviderTypeEnum = pgEnum('webhook_provider_type', [
  'wechat',
  'feishu',
  'dingtalk',
  'telegram',
  'custom',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'circuit_breaker',
  'daily_leaderboard',
  'cost_alert',
  'cache_hit_rate_alert',
]);

// Users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  // 用户标签（用于分类和筛选）
  tags: jsonb('tags').$type<string[]>().default([]),

  // New user-level quota fields (nullable for backward compatibility)
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  limitConcurrentUas: integer('limit_concurrent_uas'),

  // Daily quota reset mode (fixed: reset at specific time, rolling: 24h window)
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm format, only used in 'fixed' mode

  // User status and expiry management
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Allowed clients (CLI/IDE restrictions)
  // Empty array = no restrictions, non-empty = only listed patterns allowed
  allowedClients: jsonb('allowed_clients').$type<string[]>().default([]),

  // Allowed models (AI model restrictions)
  // Empty array = no restrictions, non-empty = only listed models allowed
  allowedModels: jsonb('allowed_models').$type<string[]>().default([]),

  // Blocked clients (CLI/IDE blocklist)
  // Non-empty = listed patterns are denied even if allowedClients permits them
  blockedClients: jsonb('blocked_clients').$type<string[]>().notNull().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 优化用户列表查询的复合索引（按角色排序,管理员优先）
  usersActiveRoleSortIdx: index('idx_users_active_role_sort').on(table.deletedAt, table.role, table.id).where(sql`${table.deletedAt} IS NULL`),
  // 优化过期用户查询的复合索引（用于定时任务），仅索引未删除的用户
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at')
    .on(table.isEnabled, table.expiresAt)
    .where(sql`${table.deletedAt} IS NULL`),
  // Tag 筛选（@>）的 GIN 索引：加速用户管理列表页的标签过滤
  usersTagsGinIdx: index('idx_users_tags_gin')
    .using('gin', table.tags)
    .where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  usersCreatedAtIdx: index('idx_users_created_at').on(table.createdAt),
  usersDeletedAtIdx: index('idx_users_deleted_at').on(table.deletedAt),
}));

// Keys table
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Web UI 登录权限控制
  canLoginWebUi: boolean('can_login_web_ui').default(false),

  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(), // fixed: 固定时间重置, rolling: 滚动窗口（24小时）
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm 格式，如 "18:00"（仅 fixed 模式使用）
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  limitConcurrentUas: integer('limit_concurrent_uas').default(0),

  // Provider group for this key (explicit; defaults to "default")
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),

  // Cache TTL override：null/NULL 表示遵循供应商或客户端请求
  cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 基础索引（详细的复合索引通过迁移脚本管理）
  keysUserIdIdx: index('idx_keys_user_id').on(table.userId),
  keysKeyIdx: index('idx_keys_key').on(table.key),
  keysCreatedAtIdx: index('idx_keys_created_at').on(table.createdAt),
  keysDeletedAtIdx: index('idx_keys_deleted_at').on(table.deletedAt),
}));

// Provider Vendors table - 以官网域名聚合的供应商实体（与 key/providerGroup 字段无关）
export const providerVendors = pgTable('provider_vendors', {
  id: serial('id').primaryKey(),
  websiteDomain: varchar('website_domain', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  websiteUrl: text('website_url'),
  faviconUrl: text('favicon_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerVendorsWebsiteDomainUnique: uniqueIndex('uniq_provider_vendors_website_domain').on(
    table.websiteDomain
  ),
  providerVendorsCreatedAtIdx: index('idx_provider_vendors_created_at').on(table.createdAt),
}));

// Providers table
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  url: varchar('url').notNull(),
  key: varchar('key').notNull(),
  providerVendorId: integer('provider_vendor_id')
    .notNull()
    .references(() => providerVendors.id, {
      onDelete: 'restrict',
    }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  weight: integer('weight').notNull().default(1),

  // 优先级和分组配置
  priority: integer('priority').notNull().default(0),
  groupPriorities: jsonb('group_priorities').$type<Record<string, number> | null>().default(null),
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0'),
  groupTag: varchar('group_tag', { length: 50 }),

  // 供应商类型：扩展支持 5 种类型
  // - claude: Anthropic 提供商（标准认证）
  // - claude-auth: Claude 中转服务（仅 Bearer 认证，不发送 x-api-key）
  // - codex: Codex CLI (Response API)
  // - gemini-cli: Gemini CLI
  // - openai-compatible: OpenAI Compatible API
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),
  // 是否透传客户端 IP（默认关闭，避免暴露真实来源）
  preserveClientIp: boolean('preserve_client_ip').notNull().default(false),

  // 模型重定向：将请求的模型名称重定向到另一个模型
  modelRedirects: jsonb('model_redirects').$type<Record<string, string>>(),

  // 模型列表：双重语义
  // - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
  // - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
  // - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
  allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null),

  // Client restrictions for this provider
  // allowedClients: empty = no restriction; non-empty = only listed patterns allowed
  // blockedClients: non-empty = listed patterns are denied
  allowedClients: jsonb('allowed_clients').$type<string[]>().notNull().default([]),
  blockedClients: jsonb('blocked_clients').$type<string[]>().notNull().default([]),

  // Scheduled active time window (HH:mm format)
  // Both null = always active; both set = active during window only
  activeTimeStart: varchar('active_time_start', { length: 5 }),
  activeTimeEnd: varchar('active_time_end', { length: 5 }),

  // Codex instructions 策略（已废弃）：历史字段保留以兼容旧数据
  // 当前运行时对 Codex 请求的 instructions 一律透传，不再读取/生效此配置
  codexInstructionsStrategy: varchar('codex_instructions_strategy', { length: 20 })
    .default('auto')
    .$type<'auto' | 'force_official' | 'keep_original'>(),

  // MCP 透传类型：控制是否启用 MCP 透传功能
  // - 'none' (默认): 不启用 MCP 透传
  // - 'minimax': 透传到 minimax MCP 服务（图片识别、联网搜索）
  // - 'glm': 透传到智谱 MCP 服务（预留）
  // - 'custom': 自定义 MCP 服务（预留）
  mcpPassthroughType: varchar('mcp_passthrough_type', { length: 20 })
    .notNull()
    .default('none')
    .$type<'none' | 'minimax' | 'glm' | 'custom'>(),

  // MCP 透传 URL：MCP 服务的基础 URL
  // 如果未配置，则自动从 provider.url 提取基础域名
  // 例如：https://api.minimaxi.com/anthropic -> https://api.minimaxi.com
  mcpPassthroughUrl: varchar('mcp_passthrough_url', { length: 512 }),

  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(), // fixed: 固定时间重置, rolling: 滚动窗口（24小时）
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm 格式，如 "18:00"（仅 fixed 模式使用）
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  limitConcurrentUas: integer('limit_concurrent_uas').default(0),

  // 熔断器配置（每个供应商独立配置）
  // null = 使用全局默认值 (env.MAX_RETRY_ATTEMPTS_DEFAULT 或 2)
  maxRetryAttempts: integer('max_retry_attempts'),
  circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').default(5),
  circuitBreakerOpenDuration: integer('circuit_breaker_open_duration').default(1800000), // 30分钟（毫秒）
  circuitBreakerHalfOpenSuccessThreshold: integer('circuit_breaker_half_open_success_threshold').default(2),

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxyUrl: varchar('proxy_url', { length: 512 }),
  proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false),

  // 超时配置（毫秒）
  // 注意：由于 undici fetch API 的限制，无法精确分离 DNS/TCP/TLS 连接阶段和响应头接收阶段
  // 参考：https://github.com/nodejs/undici/discussions/1313
  // - firstByteTimeoutStreamingMs: 流式请求首字节超时（默认 30 秒，0 = 禁用）⭐ 核心
  //   覆盖从请求开始到收到首字节的全过程：DNS + TCP + TLS + 请求发送 + 首字节接收
  //   解决流式请求重试缓慢问题
  // - streamingIdleTimeoutMs: 流式请求静默期超时（默认 0 = 不限制）⭐ 核心
  //   解决流式中途卡住问题
  //   注意：配置非 0 值时，最小必须为 60 秒
  // - requestTimeoutNonStreamingMs: 非流式请求总超时（默认 0 = 不限制）⭐ 核心
  //   防止长请求无限挂起
  firstByteTimeoutStreamingMs: integer('first_byte_timeout_streaming_ms').notNull().default(0),
  streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0),
  requestTimeoutNonStreamingMs: integer('request_timeout_non_streaming_ms')
    .notNull()
    .default(0),

  // 供应商官网地址（用于快速跳转管理）
  websiteUrl: text('website_url'),
  faviconUrl: text('favicon_url'),

  // Cache TTL override（null = 不覆写，沿用客户端请求）
  cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 }),

  // Cache TTL billing swap: when true, invert 1h<->5m for cost calculation only
  swapCacheTtlBilling: boolean('swap_cache_ttl_billing').notNull().default(false),

  // 1M Context Window 偏好配置（仅对 Anthropic 类型供应商有效）
  // - 'inherit' (默认): 遵循客户端请求，客户端带 1M header 则启用
  // - 'force_enable': 强制启用 1M 上下文（仅对支持的模型生效）
  // - 'disabled': 禁用 1M 上下文，即使客户端请求也不启用
  context1mPreference: varchar('context_1m_preference', { length: 20 }),

  // Codex（Responses API）参数覆写（仅对 Codex 类型供应商有效）
  // - 'inherit' 或 null: 遵循客户端请求
  // - 其他值: 强制覆写对应请求体字段
  codexReasoningEffortPreference: varchar('codex_reasoning_effort_preference', { length: 20 }),
  codexReasoningSummaryPreference: varchar('codex_reasoning_summary_preference', { length: 20 }),
  codexTextVerbosityPreference: varchar('codex_text_verbosity_preference', { length: 10 }),
  codexParallelToolCallsPreference: varchar('codex_parallel_tool_calls_preference', { length: 10 }),

  // Anthropic (Messages API) parameter overrides (only for claude/claude-auth providers)
  // - 'inherit' or null: follow client request
  // - numeric string: force override to that value
  anthropicMaxTokensPreference: varchar('anthropic_max_tokens_preference', { length: 20 }),
  anthropicThinkingBudgetPreference: varchar('anthropic_thinking_budget_preference', { length: 20 }),

  // Anthropic adaptive thinking config (JSONB)
  // Independent config for adaptive thinking mode; takes priority over budget override when model matches
  anthropicAdaptiveThinking: jsonb('anthropic_adaptive_thinking')
    .$type<{ effort: string; modelMatchMode: string; models: string[] } | null>()
    .default(null),

  // Gemini (generateContent API) parameter overrides (only for gemini/gemini-cli providers)
  // - 'inherit' or null: follow client request
  // - 'enabled': force inject googleSearch tool
  // - 'disabled': force remove googleSearch tool from request
  geminiGoogleSearchPreference: varchar('gemini_google_search_preference', { length: 20 }),

  // 废弃（保留向后兼容，但不再使用）
  tpm: integer('tpm').default(0),
  rpm: integer('rpm').default(0),
  rpd: integer('rpd').default(0),
  cc: integer('cc').default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 优化启用状态的服务商查询（按优先级和权重排序）
  providersEnabledPriorityIdx: index('idx_providers_enabled_priority').on(table.isEnabled, table.priority, table.weight).where(sql`${table.deletedAt} IS NULL`),
  // 分组查询优化
  providersGroupIdx: index('idx_providers_group').on(table.groupTag).where(sql`${table.deletedAt} IS NULL`),
  // #779：加速“旧 URL 是否仍被引用”的判断（vendor/type/url 精确匹配）
  providersVendorTypeUrlActiveIdx: index('idx_providers_vendor_type_url_active').on(table.providerVendorId, table.providerType, table.url).where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  providersCreatedAtIdx: index('idx_providers_created_at').on(table.createdAt),
  providersDeletedAtIdx: index('idx_providers_deleted_at').on(table.deletedAt),
  providersVendorTypeIdx: index('idx_providers_vendor_type').on(table.providerVendorId, table.providerType).where(sql`${table.deletedAt} IS NULL`),
  // #779/#781：Dashboard/Probe scheduler 的 enabled vendor/type 去重热路径
  providersEnabledVendorTypeIdx: index('idx_providers_enabled_vendor_type').on(
    table.providerVendorId,
    table.providerType
  ).where(
    sql`${table.deletedAt} IS NULL AND ${table.isEnabled} = true AND ${table.providerVendorId} IS NOT NULL AND ${table.providerVendorId} > 0`
  ),
}));

// Provider Endpoints table - 供应商(官网域名) + 类型 维度的端点池
export const providerEndpoints = pgTable('provider_endpoints', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => providerVendors.id, { onDelete: 'cascade' }),
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),
  url: text('url').notNull(),
  label: varchar('label', { length: 200 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),

  // Last probe snapshot
  lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
  lastProbeOk: boolean('last_probe_ok'),
  lastProbeStatusCode: integer('last_probe_status_code'),
  lastProbeLatencyMs: integer('last_probe_latency_ms'),
  lastProbeErrorType: varchar('last_probe_error_type', { length: 64 }),
  lastProbeErrorMessage: text('last_probe_error_message'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  providerEndpointsUnique: uniqueIndex('uniq_provider_endpoints_vendor_type_url').on(
    table.vendorId,
    table.providerType,
    table.url
  ).where(sql`${table.deletedAt} IS NULL`),
  providerEndpointsVendorTypeIdx: index('idx_provider_endpoints_vendor_type').on(
    table.vendorId,
    table.providerType
  ).where(sql`${table.deletedAt} IS NULL`),
  providerEndpointsEnabledIdx: index('idx_provider_endpoints_enabled').on(
    table.isEnabled,
    table.vendorId,
    table.providerType
  ).where(sql`${table.deletedAt} IS NULL`),
  // #779：运行时端点选择热路径（vendor/type/enabled 定位 + sort_order 有序扫描）
  providerEndpointsPickEnabledIdx: index('idx_provider_endpoints_pick_enabled').on(
    table.vendorId,
    table.providerType,
    table.isEnabled,
    table.sortOrder,
    table.id
  ).where(sql`${table.deletedAt} IS NULL`),
  providerEndpointsCreatedAtIdx: index('idx_provider_endpoints_created_at').on(table.createdAt),
  providerEndpointsDeletedAtIdx: index('idx_provider_endpoints_deleted_at').on(table.deletedAt),
}));

// Provider Endpoint Probe Logs table - 端点测活历史
export const providerEndpointProbeLogs = pgTable('provider_endpoint_probe_logs', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id')
    .notNull()
    .references(() => providerEndpoints.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 20 })
    .notNull()
    .default('scheduled')
    .$type<'scheduled' | 'manual' | 'runtime'>(),
  ok: boolean('ok').notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  errorType: varchar('error_type', { length: 64 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerEndpointProbeLogsEndpointCreatedAtIdx: index('idx_provider_endpoint_probe_logs_endpoint_created_at').on(
    table.endpointId,
    table.createdAt.desc()
  ),
  providerEndpointProbeLogsCreatedAtIdx: index('idx_provider_endpoint_probe_logs_created_at').on(table.createdAt),
}));

// Message Request table
export const messageRequest = pgTable('message_request', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  model: varchar('model', { length: 128 }),
  durationMs: integer('duration_ms'),
  costUsd: numeric('cost_usd', { precision: 21, scale: 15 }).default('0'),

  // 供应商倍率（用于日志展示，记录该请求使用的 cost_multiplier）
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }),

  // Session ID（用于会话粘性和日志追踪）
  sessionId: varchar('session_id', { length: 64 }),

  // Request Sequence（Session 内请求序号，用于区分同一 Session 的不同请求）
  requestSequence: integer('request_sequence').default(1),

  // 上游决策链（记录尝试的供应商列表）
  providerChain: jsonb('provider_chain').$type<Array<{ id: number; name: string }>>(),

  // HTTP 状态码
  statusCode: integer('status_code'),

  // Codex 支持：API 类型（'response' 或 'openai'）
  apiType: varchar('api_type', { length: 20 }),

  // 请求端点路径（用于日志筛选及非计费识别），例如：/v1/messages/count_tokens
  endpoint: varchar('endpoint', { length: 256 }),

  // 模型重定向：原始模型名称（用户请求的模型，用于前端显示和计费）
  originalModel: varchar('original_model', { length: 128 }),

  // Token 使用信息
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  ttfbMs: integer('ttfb_ms'),
  cacheCreationInputTokens: bigint('cache_creation_input_tokens', { mode: 'number' }),
  cacheReadInputTokens: bigint('cache_read_input_tokens', { mode: 'number' }),
  cacheCreation5mInputTokens: bigint('cache_creation_5m_input_tokens', { mode: 'number' }),
  cacheCreation1hInputTokens: bigint('cache_creation_1h_input_tokens', { mode: 'number' }),
  cacheTtlApplied: varchar('cache_ttl_applied', { length: 10 }),

  // 1M Context Window 应用状态
  context1mApplied: boolean('context_1m_applied').default(false),

  // Swap Cache TTL Billing: whether cache TTL inversion was active for this request
  swapCacheTtlApplied: boolean('swap_cache_ttl_applied').default(false),

  // 特殊设置（用于记录各类“特殊行为/覆写”的命中与生效情况，便于审计与展示）
  specialSettings: jsonb('special_settings').$type<SpecialSetting[]>(),

  // 错误信息
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),  // 完整堆栈信息，用于排查 TypeError: terminated 等流错误
  errorCause: text('error_cause'),  // 嵌套错误原因（JSON 格式），如 NGHTTP2_INTERNAL_ERROR

  // 拦截原因（用于记录被敏感词等规则拦截的请求）
  blockedBy: varchar('blocked_by', { length: 50 }),
  blockedReason: text('blocked_reason'),

  // User-Agent（用于客户端类型分析）
  userAgent: varchar('user_agent', { length: 512 }),

  // Messages 数量（用于短请求检测和分析）
  messagesCount: integer('messages_count'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 优化统计查询的复合索引（用户+时间+费用）
  messageRequestUserDateCostIdx: index('idx_message_request_user_date_cost').on(table.userId, table.createdAt, table.costUsd).where(sql`${table.deletedAt} IS NULL`),
  messageRequestUserCreatedAtCostStatsIdx: index('idx_message_request_user_created_at_cost_stats')
    .on(table.userId, table.createdAt, table.costUsd)
    .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),
  // 优化用户查询的复合索引（按创建时间倒序）
  messageRequestUserQueryIdx: index('idx_message_request_user_query').on(table.userId, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  messageRequestProviderCreatedAtActiveIdx: index('idx_message_request_provider_created_at_active')
    .on(table.providerId, table.createdAt)
    .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),
  // Session 查询索引（按 session 聚合查看对话）
  messageRequestSessionIdIdx: index('idx_message_request_session_id').on(table.sessionId).where(sql`${table.deletedAt} IS NULL`),
  // Session ID 前缀查询索引（LIKE 'prefix%'，可稳定命中 B-tree）
  messageRequestSessionIdPrefixIdx: index('idx_message_request_session_id_prefix').on(sql`${table.sessionId} varchar_pattern_ops`).where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),
  // Session + Sequence 复合索引（用于 Session 内请求列表查询）
  messageRequestSessionSeqIdx: index('idx_message_request_session_seq').on(table.sessionId, table.requestSequence).where(sql`${table.deletedAt} IS NULL`),
  // Endpoint 过滤查询索引（仅针对未删除数据）
  messageRequestEndpointIdx: index('idx_message_request_endpoint').on(table.endpoint).where(sql`${table.deletedAt} IS NULL`),
  // blocked_by 过滤查询索引（用于排除 warmup/sensitive 等拦截请求）
  messageRequestBlockedByIdx: index('idx_message_request_blocked_by').on(table.blockedBy).where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  messageRequestProviderIdIdx: index('idx_message_request_provider_id').on(table.providerId),
  messageRequestUserIdIdx: index('idx_message_request_user_id').on(table.userId),
  messageRequestKeyIdx: index('idx_message_request_key').on(table.key),
  // #779：Key 维度分页/时间范围查询热路径（my-usage / usage logs）
  messageRequestKeyCreatedAtIdIdx: index('idx_message_request_key_created_at_id').on(
    table.key,
    table.createdAt.desc(),
    table.id.desc()
  ).where(sql`${table.deletedAt} IS NULL`),
  // #779：my-usage 下拉筛选 DISTINCT model / endpoint（Key 维度热路径）
  messageRequestKeyModelActiveIdx: index('idx_message_request_key_model_active').on(
    table.key,
    table.model
  ).where(
    sql`${table.deletedAt} IS NULL AND ${table.model} IS NOT NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`
  ),
  messageRequestKeyEndpointActiveIdx: index('idx_message_request_key_endpoint_active').on(
    table.key,
    table.endpoint
  ).where(
    sql`${table.deletedAt} IS NULL AND ${table.endpoint} IS NOT NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`
  ),
  // #779：全局 usage logs keyset 分页热路径（按 created_at + id 倒序）
  messageRequestCreatedAtIdActiveIdx: index('idx_message_request_created_at_id_active').on(
    table.createdAt.desc(),
    table.id.desc()
  ).where(sql`${table.deletedAt} IS NULL`),
  // #779：筛选器 DISTINCT model / status_code 加速（admin usage logs）
  messageRequestModelActiveIdx: index('idx_message_request_model_active').on(table.model).where(sql`${table.deletedAt} IS NULL AND ${table.model} IS NOT NULL`),
  messageRequestStatusCodeActiveIdx: index('idx_message_request_status_code_active').on(table.statusCode).where(sql`${table.deletedAt} IS NULL AND ${table.statusCode} IS NOT NULL`),
  messageRequestCreatedAtIdx: index('idx_message_request_created_at').on(table.createdAt),
  messageRequestDeletedAtIdx: index('idx_message_request_deleted_at').on(table.deletedAt),
  // #slow-query: DISTINCT ON / LATERAL last-provider lookup per key
  messageRequestKeyLastActiveIdx: index('idx_message_request_key_last_active')
    .on(table.key, table.createdAt.desc())
    .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),
  // #slow-query: SUM(cost_usd) per key, enables index-only scan
  messageRequestKeyCostActiveIdx: index('idx_message_request_key_cost_active')
    .on(table.key, table.costUsd)
    .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),
  // #slow-query: composite index for session user-info LATERAL lookup
  // Query: WHERE session_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1
  // Provides seek + pre-sorted scan; user_id, key in index reduce heap columns to fetch.
  // user_agent/api_type still require one heap fetch per session (LIMIT 1, negligible).
  messageRequestSessionUserInfoIdx: index('idx_message_request_session_user_info')
    .on(table.sessionId, table.createdAt, table.userId, table.key)
    .where(sql`${table.deletedAt} IS NULL`),
}));

// Model Prices table
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),
  // 价格来源: 'litellm' = 从 LiteLLM 同步, 'manual' = 手动添加
  source: varchar('source', { length: 20 }).notNull().default('litellm').$type<'litellm' | 'manual'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 优化获取最新价格的复合索引
  modelPricesLatestIdx: index('idx_model_prices_latest').on(table.modelName, table.createdAt.desc()),
  // 基础索引
  modelPricesModelNameIdx: index('idx_model_prices_model_name').on(table.modelName),
  modelPricesCreatedAtIdx: index('idx_model_prices_created_at').on(table.createdAt.desc()),
  // 按来源过滤的索引
  modelPricesSourceIdx: index('idx_model_prices_source').on(table.source),
}));

// Error Rules table
export const errorRules = pgTable('error_rules', {
  id: serial('id').primaryKey(),
  pattern: text('pattern').notNull(),
  matchType: varchar('match_type', { length: 20 })
    .notNull()
    .default('regex')
    .$type<'regex' | 'contains' | 'exact'>(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  // 覆写响应体（JSONB）：匹配成功时用此响应替换原始错误响应
  // 格式参考 Claude API: { type: "error", error: { type: "...", message: "..." }, request_id?: "..." }
  // null = 不覆写，保留原始错误响应
  overrideResponse: jsonb('override_response'),
  // 覆写状态码：null = 透传上游状态码
  overrideStatusCode: integer('override_status_code'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 状态与类型查询优化
  errorRulesEnabledIdx: index('idx_error_rules_enabled').on(table.isEnabled, table.priority),
  errorRulesPatternUniqueIdx: uniqueIndex('unique_pattern').on(table.pattern),
  errorRulesCategoryIdx: index('idx_category').on(table.category),
  errorRulesMatchTypeIdx: index('idx_match_type').on(table.matchType),
}));

// Request Filters table
export const requestFilters = pgTable('request_filters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  scope: varchar('scope', { length: 20 })
    .notNull()
    .$type<'header' | 'body'>(),
  action: varchar('action', { length: 30 })
    .notNull()
    .$type<'remove' | 'set' | 'json_path' | 'text_replace'>(),
  matchType: varchar('match_type', { length: 20 }),
  target: text('target').notNull(),
  replacement: jsonb('replacement'),
  priority: integer('priority').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  bindingType: varchar('binding_type', { length: 20 })
    .notNull()
    .default('global')
    .$type<'global' | 'providers' | 'groups'>(),
  providerIds: jsonb('provider_ids').$type<number[] | null>(),
  groupTags: jsonb('group_tags').$type<string[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  requestFiltersEnabledIdx: index('idx_request_filters_enabled').on(table.isEnabled, table.priority),
  requestFiltersScopeIdx: index('idx_request_filters_scope').on(table.scope),
  requestFiltersActionIdx: index('idx_request_filters_action').on(table.action),
  requestFiltersBindingIdx: index('idx_request_filters_binding').on(table.isEnabled, table.bindingType),
}));

// Sensitive Words table
export const sensitiveWords = pgTable('sensitive_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 255 }).notNull(),
  matchType: varchar('match_type', { length: 20 }).notNull().default('contains'),
  description: text('description'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 优化启用状态和匹配类型的查询
  sensitiveWordsEnabledIdx: index('idx_sensitive_words_enabled').on(table.isEnabled, table.matchType),
  // 基础索引
  sensitiveWordsCreatedAtIdx: index('idx_sensitive_words_created_at').on(table.createdAt),
}));

// System Settings table
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  siteTitle: varchar('site_title', { length: 128 }).notNull().default('Claude Code Hub'),
  allowGlobalUsageView: boolean('allow_global_usage_view').notNull().default(false),

  // 货币显示配置
  currencyDisplay: varchar('currency_display', { length: 10 }).notNull().default('USD'),

  // 计费模型来源配置: 'original' (重定向前) | 'redirected' (重定向后)
  billingModelSource: varchar('billing_model_source', { length: 20 }).notNull().default('original'),

  // 系统时区配置 (IANA timezone identifier)
  // 用于统一后端时间边界计算和前端日期/时间显示
  // null 表示使用环境变量 TZ 或默认 UTC
  timezone: varchar('timezone', { length: 64 }),

  // 日志清理配置
  enableAutoCleanup: boolean('enable_auto_cleanup').default(false),
  cleanupRetentionDays: integer('cleanup_retention_days').default(30),
  cleanupSchedule: varchar('cleanup_schedule', { length: 50 }).default('0 2 * * *'),
  cleanupBatchSize: integer('cleanup_batch_size').default(10000),

  // 客户端版本检查配置
  enableClientVersionCheck: boolean('enable_client_version_check').notNull().default(false),

  // 供应商不可用时是否返回详细错误信息
  verboseProviderError: boolean('verbose_provider_error').notNull().default(false),

  // 启用 HTTP/2 连接供应商（默认关闭，启用后自动回退到 HTTP/1.1 失败时）
  enableHttp2: boolean('enable_http2').notNull().default(false),

  // 可选拦截 Anthropic Warmup 请求（默认关闭）
  // 开启后：对 /v1/messages 的 Warmup 请求直接由 CCH 抢答，避免打到上游供应商
  interceptAnthropicWarmupRequests: boolean('intercept_anthropic_warmup_requests')
    .notNull()
    .default(false),

  // thinking signature 整流器（默认开启）
  // 开启后：当 Anthropic 类型供应商出现 thinking 签名不兼容/非法请求等 400 错误时，自动整流并重试一次
  enableThinkingSignatureRectifier: boolean('enable_thinking_signature_rectifier')
    .notNull()
    .default(true),

  // thinking budget 整流器（默认开启）
  // 开启后：当 Anthropic 类型供应商出现 budget_tokens < 1024 错误时，自动整流并重试一次
  enableThinkingBudgetRectifier: boolean('enable_thinking_budget_rectifier')
    .notNull()
    .default(true),

  // billing header 整流器（默认开启）
  // 开启后：主动移除 Claude Code 客户端注入到 system 提示中的 x-anthropic-billing-header 文本块
  enableBillingHeaderRectifier: boolean('enable_billing_header_rectifier')
    .notNull()
    .default(true),

  // Codex Session ID 补全（默认开启）
  // 开启后：当 Codex 请求缺少 session_id / prompt_cache_key 时，自动补全或生成稳定的会话标识
  enableCodexSessionIdCompletion: boolean('enable_codex_session_id_completion')
    .notNull()
    .default(true),

  // Claude metadata.user_id 注入（默认开启）
  // 开启后：当 Claude 请求缺少 metadata.user_id 时，自动注入稳定标识用于提升缓存命中
  enableClaudeMetadataUserIdInjection: boolean('enable_claude_metadata_user_id_injection')
    .notNull()
    .default(true),

  // 响应整流（默认开启）
  enableResponseFixer: boolean('enable_response_fixer').notNull().default(true),
  responseFixerConfig: jsonb('response_fixer_config')
    .$type<ResponseFixerConfig>()
    .default({
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    }),

  // Quota lease settings
  quotaDbRefreshIntervalSeconds: integer('quota_db_refresh_interval_seconds').default(10),
  quotaLeasePercent5h: numeric('quota_lease_percent_5h', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentDaily: numeric('quota_lease_percent_daily', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentWeekly: numeric('quota_lease_percent_weekly', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentMonthly: numeric('quota_lease_percent_monthly', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeaseCapUsd: numeric('quota_lease_cap_usd', { precision: 10, scale: 2 }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Notification Settings table - Webhook 通知配置
export const notificationSettings = pgTable('notification_settings', {
  id: serial('id').primaryKey(),

  // 全局开关
  enabled: boolean('enabled').notNull().default(false),
  // 兼容旧配置：默认使用 legacy 字段（单 URL / 自动识别），创建新目标后会切到新模式
  useLegacyMode: boolean('use_legacy_mode').notNull().default(false),

  // 熔断器告警配置
  circuitBreakerEnabled: boolean('circuit_breaker_enabled').notNull().default(false),
  circuitBreakerWebhook: varchar('circuit_breaker_webhook', { length: 512 }),

  // 每日用户消费排行榜配置
  dailyLeaderboardEnabled: boolean('daily_leaderboard_enabled').notNull().default(false),
  dailyLeaderboardWebhook: varchar('daily_leaderboard_webhook', { length: 512 }),
  dailyLeaderboardTime: varchar('daily_leaderboard_time', { length: 10 }).default('09:00'), // HH:mm 格式
  dailyLeaderboardTopN: integer('daily_leaderboard_top_n').default(5), // 显示前 N 名

  // 成本预警配置
  costAlertEnabled: boolean('cost_alert_enabled').notNull().default(false),
  costAlertWebhook: varchar('cost_alert_webhook', { length: 512 }),
  costAlertThreshold: numeric('cost_alert_threshold', { precision: 5, scale: 2 }).default('0.80'), // 阈值 0-1 (80% = 0.80)
  costAlertCheckInterval: integer('cost_alert_check_interval').default(60), // 检查间隔（分钟）

  // 缓存命中率异常告警配置（provider × model）
  cacheHitRateAlertEnabled: boolean('cache_hit_rate_alert_enabled').notNull().default(false),
  cacheHitRateAlertWebhook: varchar('cache_hit_rate_alert_webhook', { length: 512 }),
  cacheHitRateAlertWindowMode: varchar('cache_hit_rate_alert_window_mode', { length: 10 }).default('auto'),
  cacheHitRateAlertCheckInterval: integer('cache_hit_rate_alert_check_interval').default(5), // 检查间隔（分钟）
  cacheHitRateAlertHistoricalLookbackDays: integer('cache_hit_rate_alert_historical_lookback_days').default(7),
  cacheHitRateAlertMinEligibleRequests: integer('cache_hit_rate_alert_min_eligible_requests').default(20),
  cacheHitRateAlertMinEligibleTokens: integer('cache_hit_rate_alert_min_eligible_tokens').default(0),
  cacheHitRateAlertAbsMin: numeric('cache_hit_rate_alert_abs_min', { precision: 5, scale: 4 }).default('0.05'),
  cacheHitRateAlertDropRel: numeric('cache_hit_rate_alert_drop_rel', { precision: 5, scale: 4 }).default('0.3'),
  cacheHitRateAlertDropAbs: numeric('cache_hit_rate_alert_drop_abs', { precision: 5, scale: 4 }).default('0.1'),
  cacheHitRateAlertCooldownMinutes: integer('cache_hit_rate_alert_cooldown_minutes').default(30),
  cacheHitRateAlertTopN: integer('cache_hit_rate_alert_top_n').default(10),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Webhook Targets table - 推送目标（多平台配置）
export const webhookTargets = pgTable('webhook_targets', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  providerType: webhookProviderTypeEnum('provider_type').notNull(),

  // 通用配置
  webhookUrl: varchar('webhook_url', { length: 1024 }),

  // Telegram 特有配置
  telegramBotToken: varchar('telegram_bot_token', { length: 256 }),
  telegramChatId: varchar('telegram_chat_id', { length: 64 }),

  // 钉钉签名配置
  dingtalkSecret: varchar('dingtalk_secret', { length: 256 }),

  // 自定义 Webhook 配置
  customTemplate: jsonb('custom_template'),
  customHeaders: jsonb('custom_headers'),

  // 代理配置
  proxyUrl: varchar('proxy_url', { length: 512 }),
  proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false),

  // 元数据
  isEnabled: boolean('is_enabled').notNull().default(true),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestResult: jsonb('last_test_result'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Notification Target Bindings table - 通知类型与目标绑定
export const notificationTargetBindings = pgTable(
  'notification_target_bindings',
  {
    id: serial('id').primaryKey(),
    notificationType: notificationTypeEnum('notification_type').notNull(),
    targetId: integer('target_id')
      .notNull()
      .references(() => webhookTargets.id, { onDelete: 'cascade' }),

    isEnabled: boolean('is_enabled').notNull().default(true),

    // 定时配置覆盖（可选，仅用于定时类通知）
    // null 表示使用系统时区（由运行时 resolveSystemTimezone() 决定）
    scheduleCron: varchar('schedule_cron', { length: 100 }),
    scheduleTimezone: varchar('schedule_timezone', { length: 50 }),

    // 模板覆盖（可选，主要用于 custom webhook）
    templateOverride: jsonb('template_override'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueBinding: uniqueIndex('unique_notification_target_binding').on(
      table.notificationType,
      table.targetId
    ),
    bindingsTypeIdx: index('idx_notification_bindings_type').on(
      table.notificationType,
      table.isEnabled
    ),
    bindingsTargetIdx: index('idx_notification_bindings_target').on(table.targetId, table.isEnabled),
  })
);

// Usage Ledger table - immutable audit log, no FK constraints, no deletedAt/updatedAt
export const usageLedger = pgTable('usage_ledger', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  providerId: integer('provider_id').notNull(),
  finalProviderId: integer('final_provider_id').notNull(),
  model: varchar('model', { length: 128 }),
  originalModel: varchar('original_model', { length: 128 }),
  endpoint: varchar('endpoint', { length: 256 }),
  apiType: varchar('api_type', { length: 20 }),
  sessionId: varchar('session_id', { length: 64 }),
  statusCode: integer('status_code'),
  isSuccess: boolean('is_success').notNull().default(false),
  blockedBy: varchar('blocked_by', { length: 50 }),
  costUsd: numeric('cost_usd', { precision: 21, scale: 15 }).default('0'),
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }),
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  cacheCreationInputTokens: bigint('cache_creation_input_tokens', { mode: 'number' }),
  cacheReadInputTokens: bigint('cache_read_input_tokens', { mode: 'number' }),
  cacheCreation5mInputTokens: bigint('cache_creation_5m_input_tokens', { mode: 'number' }),
  cacheCreation1hInputTokens: bigint('cache_creation_1h_input_tokens', { mode: 'number' }),
  cacheTtlApplied: varchar('cache_ttl_applied', { length: 10 }),
  context1mApplied: boolean('context_1m_applied').default(false),
  swapCacheTtlApplied: boolean('swap_cache_ttl_applied').default(false),
  durationMs: integer('duration_ms'),
  ttfbMs: integer('ttfb_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => ({
  // UNIQUE on requestId (survives message_request log deletion)
  usageLedgerRequestIdIdx: uniqueIndex('idx_usage_ledger_request_id').on(table.requestId),
  usageLedgerUserCreatedAtIdx: index('idx_usage_ledger_user_created_at')
    .on(table.userId, table.createdAt)
    .where(sql`${table.blockedBy} IS NULL`),
  usageLedgerKeyCreatedAtIdx: index('idx_usage_ledger_key_created_at')
    .on(table.key, table.createdAt)
    .where(sql`${table.blockedBy} IS NULL`),
  usageLedgerProviderCreatedAtIdx: index('idx_usage_ledger_provider_created_at')
    .on(table.finalProviderId, table.createdAt)
    .where(sql`${table.blockedBy} IS NULL`),
  // Expression index on minute truncation - AT TIME ZONE 'UTC' makes date_trunc IMMUTABLE on timestamptz
  usageLedgerCreatedAtMinuteIdx: index('idx_usage_ledger_created_at_minute')
    .on(sql`date_trunc('minute', ${table.createdAt} AT TIME ZONE 'UTC')`),
  usageLedgerCreatedAtDescIdIdx: index('idx_usage_ledger_created_at_desc_id')
    .on(table.createdAt.desc(), table.id.desc()),
  usageLedgerSessionIdIdx: index('idx_usage_ledger_session_id')
    .on(table.sessionId)
    .where(sql`${table.sessionId} IS NOT NULL`),
  usageLedgerModelIdx: index('idx_usage_ledger_model')
    .on(table.model)
    .where(sql`${table.model} IS NOT NULL`),
  // #slow-query: covering index for SUM(cost_usd) per key (replaces old key+cost, adds created_at for time range)
  usageLedgerKeyCostIdx: index('idx_usage_ledger_key_cost')
    .on(table.key, table.createdAt, table.costUsd)
    .where(sql`${table.blockedBy} IS NULL`),
  // #slow-query: covering index for SUM(cost_usd) per user (Quotas page + rate-limit total)
  // Keys: user_id (equality), created_at (range filter), cost_usd (aggregation, index-only scan)
  usageLedgerUserCostCoverIdx: index('idx_usage_ledger_user_cost_cover')
    .on(table.userId, table.createdAt, table.costUsd)
    .where(sql`${table.blockedBy} IS NULL`),
  // #slow-query: covering index for SUM(cost_usd) per provider (rate-limit total)
  usageLedgerProviderCostCoverIdx: index('idx_usage_ledger_provider_cost_cover')
    .on(table.finalProviderId, table.createdAt, table.costUsd)
    .where(sql`${table.blockedBy} IS NULL`),
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  keys: many(keys),
  messageRequests: many(messageRequest),
}));

export const keysRelations = relations(keys, ({ one, many }) => ({
  user: one(users, {
    fields: [keys.userId],
    references: [users.id],
  }),
  messageRequests: many(messageRequest),
}));

export const providersRelations = relations(providers, ({ many, one }) => ({
  vendor: one(providerVendors, {
    fields: [providers.providerVendorId],
    references: [providerVendors.id],
  }),
  messageRequests: many(messageRequest),
}));

export const providerVendorsRelations = relations(providerVendors, ({ many }) => ({
  providers: many(providers),
  endpoints: many(providerEndpoints),
}));

export const providerEndpointsRelations = relations(providerEndpoints, ({ many, one }) => ({
  vendor: one(providerVendors, {
    fields: [providerEndpoints.vendorId],
    references: [providerVendors.id],
  }),
  probeLogs: many(providerEndpointProbeLogs),
}));

export const providerEndpointProbeLogsRelations = relations(providerEndpointProbeLogs, ({ one }) => ({
  endpoint: one(providerEndpoints, {
    fields: [providerEndpointProbeLogs.endpointId],
    references: [providerEndpoints.id],
  }),
}));

export const messageRequestRelations = relations(messageRequest, ({ one }) => ({
  user: one(users, {
    fields: [messageRequest.userId],
    references: [users.id],
  }),
  provider: one(providers, {
    fields: [messageRequest.providerId],
    references: [providers.id],
  }),
}));
