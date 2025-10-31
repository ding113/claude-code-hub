import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  rpmLimit: integer('rpm_limit').default(60),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }).default('100.00'),
  providerGroup: varchar('provider_group', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 优化用户列表查询的复合索引（按角色排序，管理员优先）
  usersActiveRoleSortIdx: index('idx_users_active_role_sort').on(table.deletedAt, table.role, table.id).where(sql`${table.deletedAt} IS NULL`),
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
  expiresAt: timestamp('expires_at'),

  // Web UI 登录权限控制
  canLoginWebUi: boolean('can_login_web_ui').default(true),

  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 基础索引（详细的复合索引通过迁移脚本管理）
  keysUserIdIdx: index('idx_keys_user_id').on(table.userId),
  keysCreatedAtIdx: index('idx_keys_created_at').on(table.createdAt),
  keysDeletedAtIdx: index('idx_keys_deleted_at').on(table.deletedAt),
}));

// Providers table
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  url: varchar('url').notNull(),
  key: varchar('key').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  weight: integer('weight').notNull().default(1),

  // 优先级和分组配置
  priority: integer('priority').notNull().default(0),
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
    .$type<'claude' | 'claude-auth' | 'codex' | 'gemini-cli' | 'openai-compatible'>(),

  // 模型重定向：将请求的模型名称重定向到另一个模型
  modelRedirects: jsonb('model_redirects').$type<Record<string, string>>(),

  // 模型列表：双重语义
  // - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
  // - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
  // - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
  allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null),

  // 加入 Claude 调度池：仅对非 Anthropic 提供商有效
  // 启用后，如果该提供商配置了重定向到 claude-* 模型，可以加入 claude 调度池
  joinClaudePool: boolean('join_claude_pool').default(false),

  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),

  // 熔断器配置（每个供应商独立配置）
  circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').default(5),
  circuitBreakerOpenDuration: integer('circuit_breaker_open_duration').default(1800000), // 30分钟（毫秒）
  circuitBreakerHalfOpenSuccessThreshold: integer('circuit_breaker_half_open_success_threshold').default(2),

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
  // 基础索引
  providersCreatedAtIdx: index('idx_providers_created_at').on(table.createdAt),
  providersDeletedAtIdx: index('idx_providers_deleted_at').on(table.deletedAt),
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

  // 上游决策链（记录尝试的供应商列表）
  providerChain: jsonb('provider_chain').$type<Array<{ id: number; name: string }>>(),

  // HTTP 状态码
  statusCode: integer('status_code'),

  // Codex 支持：API 类型（'response' 或 'openai'）
  apiType: varchar('api_type', { length: 20 }),

  // 模型重定向：原始模型名称（用户请求的模型，用于前端显示和计费）
  originalModel: varchar('original_model', { length: 128 }),

  // Token 使用信息
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheCreationInputTokens: integer('cache_creation_input_tokens'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),

  // 错误信息
  errorMessage: text('error_message'),

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
  // 优化用户查询的复合索引（按创建时间倒序）
  messageRequestUserQueryIdx: index('idx_message_request_user_query').on(table.userId, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  // Session 查询索引（按 session 聚合查看对话）
  messageRequestSessionIdIdx: index('idx_message_request_session_id').on(table.sessionId).where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  messageRequestProviderIdIdx: index('idx_message_request_provider_id').on(table.providerId),
  messageRequestUserIdIdx: index('idx_message_request_user_id').on(table.userId),
  messageRequestKeyIdx: index('idx_message_request_key').on(table.key),
  messageRequestCreatedAtIdx: index('idx_message_request_created_at').on(table.createdAt),
  messageRequestDeletedAtIdx: index('idx_message_request_deleted_at').on(table.deletedAt),
}));

// Model Prices table
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 优化获取最新价格的复合索引
  modelPricesLatestIdx: index('idx_model_prices_latest').on(table.modelName, table.createdAt.desc()),
  // 基础索引
  modelPricesModelNameIdx: index('idx_model_prices_model_name').on(table.modelName),
  modelPricesCreatedAtIdx: index('idx_model_prices_created_at').on(table.createdAt.desc()),
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

  // 日志清理配置
  enableAutoCleanup: boolean('enable_auto_cleanup').default(false),
  cleanupRetentionDays: integer('cleanup_retention_days').default(30),
  cleanupSchedule: varchar('cleanup_schedule', { length: 50 }).default('0 2 * * *'),
  cleanupBatchSize: integer('cleanup_batch_size').default(10000),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Notification Settings table - 企业微信机器人通知配置
export const notificationSettings = pgTable('notification_settings', {
  id: serial('id').primaryKey(),

  // 全局开关
  enabled: boolean('enabled').notNull().default(false),

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

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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

export const providersRelations = relations(providers, ({ many }) => ({
  messageRequests: many(messageRequest),
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
