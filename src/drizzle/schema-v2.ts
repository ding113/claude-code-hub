import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

import { dailyResetModeEnum } from "./schema";

// Enums
export const vendorCategoryEnum = pgEnum("vendor_category", ["official", "relay", "self_hosted"]);
export const vendorApiFormatEnum = pgEnum("vendor_api_format", ["claude", "codex", "gemini"]);
export const modelPriceSourceEnum = pgEnum("model_price_source_v2", ["remote", "local", "user"]);

// vendors: 真正的供应商（Anthropic, OpenAI, Google...）
export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    category: vendorCategoryEnum("category").notNull(),
    isManaged: boolean("is_managed").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),

    // 用户标签（用于分类和筛选）
    tags: jsonb("tags").$type<string[]>().default([]),

    // 供应商官网信息（用于管理后台展示）
    websiteUrl: text("website_url"),
    faviconUrl: text("favicon_url"),

    // balance_check_*：余额检查配置（endpoint + JSONPath 表达式）
    balanceCheckEnabled: boolean("balance_check_enabled").notNull().default(false),
    balanceCheckEndpoint: varchar("balance_check_endpoint", { length: 512 }),
    balanceCheckJsonpath: text("balance_check_jsonpath"),
    balanceCheckIntervalSeconds: integer("balance_check_interval_seconds"),
    balanceCheckLowThresholdUsd: numeric("balance_check_low_threshold_usd", {
      precision: 10,
      scale: 2,
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    vendorsSlugUniqueIdx: uniqueIndex("unique_vendors_slug").on(table.slug),
    vendorsEnabledCategoryIdx: index("idx_vendors_enabled_category")
      .on(table.isEnabled, table.category)
      .where(sql`${table.deletedAt} IS NULL`),
    vendorsCreatedAtIdx: index("idx_vendors_created_at").on(table.createdAt),
    vendorsDeletedAtIdx: index("idx_vendors_deleted_at").on(table.deletedAt),
  }),
);

// vendor_endpoints: 供应商线路（一个供应商多条线路）
export const vendorEndpoints = pgTable(
  "vendor_endpoints",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    url: varchar("url", { length: 512 }).notNull(),
    apiFormat: vendorApiFormatEnum("api_format").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),

    // Endpoint 选择排序（延迟/优先级等）
    priority: integer("priority").notNull().default(0),
    latencyMs: integer("latency_ms"),

    // health_check_*：健康检查配置
    healthCheckEnabled: boolean("health_check_enabled").notNull().default(false),
    healthCheckEndpoint: varchar("health_check_endpoint", { length: 512 }),
    healthCheckIntervalSeconds: integer("health_check_interval_seconds"),
    healthCheckTimeoutMs: integer("health_check_timeout_ms"),
    healthCheckLastCheckedAt: timestamp("health_check_last_checked_at", { withTimezone: true }),
    healthCheckLastStatusCode: integer("health_check_last_status_code"),
    healthCheckErrorMessage: text("health_check_error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    vendorEndpointsVendorIdx: index("idx_vendor_endpoints_vendor_id")
      .on(table.vendorId)
      .where(sql`${table.deletedAt} IS NULL`),
    vendorEndpointsEnabledFormatIdx: index("idx_vendor_endpoints_enabled_format")
      .on(table.isEnabled, table.apiFormat, table.priority, table.latencyMs)
      .where(sql`${table.deletedAt} IS NULL`),
    vendorEndpointsCreatedAtIdx: index("idx_vendor_endpoints_created_at").on(table.createdAt),
    vendorEndpointsDeletedAtIdx: index("idx_vendor_endpoints_deleted_at").on(table.deletedAt),
  }),
);

// vendor_keys: 供应商密钥（继承原 providers 字段，增加 user override 与余额缓存）
export const vendorKeys = pgTable(
  "vendor_keys",
  {
    id: serial("id").primaryKey(),

    vendorId: integer("vendor_id").notNull(),
    endpointId: integer("endpoint_id").notNull(),

    // 云端/本地配置合并时的保护标记：true = 不被远程配置覆盖
    isUserOverride: boolean("is_user_override").notNull().default(false),

    // balance_usd：余额缓存（定时任务更新）
    balanceUsd: numeric("balance_usd", { precision: 21, scale: 6 }),
    balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }),

    // ====== providers 表字段（继承） ======
    name: varchar("name").notNull(),
    description: text("description"),
    url: varchar("url").notNull(),
    key: varchar("key").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    weight: integer("weight").notNull().default(1),

    // 优先级和分组配置
    priority: integer("priority").notNull().default(0),
    costMultiplier: numeric("cost_multiplier", { precision: 10, scale: 4 }).default("1.0"),
    groupTag: varchar("group_tag", { length: 50 }),

    // 供应商类型（保留向后兼容）
    providerType: varchar("provider_type", { length: 20 })
      .notNull()
      .default("claude")
      .$type<"claude" | "claude-auth" | "codex" | "gemini-cli" | "gemini" | "openai-compatible">(),
    preserveClientIp: boolean("preserve_client_ip").notNull().default(false),

    // 模型重定向
    modelRedirects: jsonb("model_redirects").$type<Record<string, string>>(),
    allowedModels: jsonb("allowed_models").$type<string[] | null>().default(null),
    joinClaudePool: boolean("join_claude_pool").default(false),

    // Codex Instructions 策略
    codexInstructionsStrategy: varchar("codex_instructions_strategy", { length: 20 })
      .default("auto")
      .$type<"auto" | "force_official" | "keep_original">(),

    // MCP 透传配置
    mcpPassthroughType: varchar("mcp_passthrough_type", { length: 20 })
      .notNull()
      .default("none")
      .$type<"none" | "minimax" | "glm" | "custom">(),
    mcpPassthroughUrl: varchar("mcp_passthrough_url", { length: 512 }),

    // 金额限流配置
    limit5hUsd: numeric("limit_5h_usd", { precision: 10, scale: 2 }),
    limitDailyUsd: numeric("limit_daily_usd", { precision: 10, scale: 2 }),
    dailyResetMode: dailyResetModeEnum("daily_reset_mode").default("fixed").notNull(),
    dailyResetTime: varchar("daily_reset_time", { length: 5 }).default("00:00").notNull(),
    limitWeeklyUsd: numeric("limit_weekly_usd", { precision: 10, scale: 2 }),
    limitMonthlyUsd: numeric("limit_monthly_usd", { precision: 10, scale: 2 }),
    limitConcurrentSessions: integer("limit_concurrent_sessions").default(0),

    // 熔断器配置
    maxRetryAttempts: integer("max_retry_attempts"),
    circuitBreakerFailureThreshold: integer("circuit_breaker_failure_threshold").default(5),
    circuitBreakerOpenDuration: integer("circuit_breaker_open_duration").default(1800000),
    circuitBreakerHalfOpenSuccessThreshold: integer("circuit_breaker_half_open_success_threshold").default(
      2,
    ),

    // 代理配置
    proxyUrl: varchar("proxy_url", { length: 512 }),
    proxyFallbackToDirect: boolean("proxy_fallback_to_direct").default(false),

    // 超时配置
    firstByteTimeoutStreamingMs: integer("first_byte_timeout_streaming_ms").notNull().default(0),
    streamingIdleTimeoutMs: integer("streaming_idle_timeout_ms").notNull().default(0),
    requestTimeoutNonStreamingMs: integer("request_timeout_non_streaming_ms").notNull().default(0),

    websiteUrl: text("website_url"),
    faviconUrl: text("favicon_url"),
    cacheTtlPreference: varchar("cache_ttl_preference", { length: 10 }),
    context1mPreference: varchar("context_1m_preference", { length: 20 }),

    // 废弃（保留向后兼容，但不再使用）
    tpm: integer("tpm").default(0),
    rpm: integer("rpm").default(0),
    rpd: integer("rpd").default(0),
    cc: integer("cc").default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    vendorKeysVendorEndpointIdx: index("idx_vendor_keys_vendor_endpoint")
      .on(table.vendorId, table.endpointId, table.isEnabled)
      .where(sql`${table.deletedAt} IS NULL`),
    vendorKeysGroupIdx: index("idx_vendor_keys_group")
      .on(table.groupTag)
      .where(sql`${table.deletedAt} IS NULL`),
    vendorKeysCreatedAtIdx: index("idx_vendor_keys_created_at").on(table.createdAt),
    vendorKeysDeletedAtIdx: index("idx_vendor_keys_deleted_at").on(table.deletedAt),
  }),
);

// vendor_balance_checks: 余额检查历史
export const vendorBalanceChecks = pgTable(
  "vendor_balance_checks",
  {
    id: serial("id").primaryKey(),
    vendorKeyId: integer("vendor_key_id").notNull(),
    vendorId: integer("vendor_id"),
    endpointId: integer("endpoint_id"),

    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    statusCode: integer("status_code"),
    isSuccess: boolean("is_success").notNull().default(false),

    balanceUsd: numeric("balance_usd", { precision: 21, scale: 6 }),
    rawResponse: jsonb("raw_response"),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    vendorBalanceChecksKeyCheckedAtIdx: index("idx_vendor_balance_checks_key_checked_at").on(
      table.vendorKeyId,
      table.checkedAt.desc(),
    ),
    vendorBalanceChecksVendorCheckedAtIdx: index("idx_vendor_balance_checks_vendor_checked_at").on(
      table.vendorId,
      table.checkedAt.desc(),
    ),
  }),
);

// model_prices_v2: 价格表 v2（支持来源追踪和用户覆写）
export const modelPricesV2 = pgTable(
  "model_prices_v2",
  {
    id: serial("id").primaryKey(),
    modelName: varchar("model_name").notNull(),
    priceData: jsonb("price_data").notNull(),

    // remote | local | user
    source: modelPriceSourceEnum("source").notNull(),
    isUserOverride: boolean("is_user_override").notNull().default(false),
    remoteVersion: varchar("remote_version", { length: 64 }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    modelPricesV2LatestIdx: index("idx_model_prices_v2_latest").on(table.modelName, table.createdAt.desc()),
    modelPricesV2ModelNameIdx: index("idx_model_prices_v2_model_name").on(table.modelName),
    modelPricesV2SourceIdx: index("idx_model_prices_v2_source").on(table.source),
    modelPricesV2CreatedAtIdx: index("idx_model_prices_v2_created_at").on(table.createdAt.desc()),
  }),
);

// remote_config_sync: 远程配置同步状态
export const remoteConfigSync = pgTable(
  "remote_config_sync",
  {
    id: serial("id").primaryKey(),
    configKey: varchar("config_key", { length: 64 }).notNull(),
    remoteVersion: varchar("remote_version", { length: 64 }),

    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    remoteConfigSyncKeyUniqueIdx: uniqueIndex("unique_remote_config_sync_key").on(table.configKey),
    remoteConfigSyncUpdatedAtIdx: index("idx_remote_config_sync_updated_at").on(table.updatedAt.desc()),
  }),
);

// Relations
export const vendorsRelations = relations(vendors, ({ many }) => ({
  endpoints: many(vendorEndpoints),
  keys: many(vendorKeys),
  balanceChecks: many(vendorBalanceChecks),
}));

export const vendorEndpointsRelations = relations(vendorEndpoints, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [vendorEndpoints.vendorId],
    references: [vendors.id],
  }),
  keys: many(vendorKeys),
}));

export const vendorKeysRelations = relations(vendorKeys, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [vendorKeys.vendorId],
    references: [vendors.id],
  }),
  endpoint: one(vendorEndpoints, {
    fields: [vendorKeys.endpointId],
    references: [vendorEndpoints.id],
  }),
  balanceChecks: many(vendorBalanceChecks),
}));

export const vendorBalanceChecksRelations = relations(vendorBalanceChecks, ({ one }) => ({
  key: one(vendorKeys, {
    fields: [vendorBalanceChecks.vendorKeyId],
    references: [vendorKeys.id],
  }),
}));

