-- Phase 1: Vendor architecture tables (v0.4)
-- 新表，不修改旧表

-- Enums (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_category') THEN
    CREATE TYPE "vendor_category" AS ENUM ('official', 'relay', 'self_hosted');
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_api_format') THEN
    CREATE TYPE "vendor_api_format" AS ENUM ('claude', 'codex', 'gemini');
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'model_price_source_v2') THEN
    CREATE TYPE "model_price_source_v2" AS ENUM ('remote', 'local', 'user');
  END IF;
END $$;
--> statement-breakpoint

-- vendors
CREATE TABLE IF NOT EXISTS "vendors" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" varchar(64) NOT NULL,
  "name" varchar(128) NOT NULL,
  "description" text,
  "category" "vendor_category" NOT NULL,
  "is_managed" boolean DEFAULT false NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "website_url" text,
  "favicon_url" text,
  "balance_check_enabled" boolean DEFAULT false NOT NULL,
  "balance_check_endpoint" varchar(512),
  "balance_check_jsonpath" text,
  "balance_check_interval_seconds" integer,
  "balance_check_low_threshold_usd" numeric(10, 2),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unique_vendors_slug" ON "vendors" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendors_enabled_category" ON "vendors" USING btree ("is_enabled","category") WHERE "vendors"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendors_created_at" ON "vendors" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendors_deleted_at" ON "vendors" USING btree ("deleted_at");
--> statement-breakpoint

-- vendor_endpoints
CREATE TABLE IF NOT EXISTS "vendor_endpoints" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_id" integer NOT NULL,
  "name" varchar(128) NOT NULL,
  "url" varchar(512) NOT NULL,
  "api_format" "vendor_api_format" NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer,
  "health_check_enabled" boolean DEFAULT false NOT NULL,
  "health_check_endpoint" varchar(512),
  "health_check_interval_seconds" integer,
  "health_check_timeout_ms" integer,
  "health_check_last_checked_at" timestamp with time zone,
  "health_check_last_status_code" integer,
  "health_check_error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vendor_endpoints_vendor_id" ON "vendor_endpoints" USING btree ("vendor_id") WHERE "vendor_endpoints"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_endpoints_enabled_format" ON "vendor_endpoints" USING btree ("is_enabled","api_format","priority","latency_ms") WHERE "vendor_endpoints"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_endpoints_created_at" ON "vendor_endpoints" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_endpoints_deleted_at" ON "vendor_endpoints" USING btree ("deleted_at");
--> statement-breakpoint

-- vendor_keys (inherits providers fields)
CREATE TABLE IF NOT EXISTS "vendor_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_id" integer NOT NULL,
  "endpoint_id" integer NOT NULL,
  "is_user_override" boolean DEFAULT false NOT NULL,
  "balance_usd" numeric(21, 6),
  "balance_updated_at" timestamp with time zone,

  "name" varchar NOT NULL,
  "description" text,
  "url" varchar NOT NULL,
  "key" varchar NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "weight" integer DEFAULT 1 NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "cost_multiplier" numeric(10, 4) DEFAULT '1.0',
  "group_tag" varchar(50),
  "provider_type" varchar(20) DEFAULT 'claude' NOT NULL,
  "preserve_client_ip" boolean DEFAULT false NOT NULL,
  "model_redirects" jsonb,
  "allowed_models" jsonb DEFAULT null,
  "join_claude_pool" boolean DEFAULT false,
  "codex_instructions_strategy" varchar(20) DEFAULT 'auto',
  "mcp_passthrough_type" varchar(20) DEFAULT 'none' NOT NULL,
  "mcp_passthrough_url" varchar(512),
  "limit_5h_usd" numeric(10, 2),
  "limit_daily_usd" numeric(10, 2),
  "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL,
  "daily_reset_time" varchar(5) DEFAULT '00:00' NOT NULL,
  "limit_weekly_usd" numeric(10, 2),
  "limit_monthly_usd" numeric(10, 2),
  "limit_concurrent_sessions" integer DEFAULT 0,
  "max_retry_attempts" integer,
  "circuit_breaker_failure_threshold" integer DEFAULT 5,
  "circuit_breaker_open_duration" integer DEFAULT 1800000,
  "circuit_breaker_half_open_success_threshold" integer DEFAULT 2,
  "proxy_url" varchar(512),
  "proxy_fallback_to_direct" boolean DEFAULT false,
  "first_byte_timeout_streaming_ms" integer DEFAULT 0 NOT NULL,
  "streaming_idle_timeout_ms" integer DEFAULT 0 NOT NULL,
  "request_timeout_non_streaming_ms" integer DEFAULT 0 NOT NULL,
  "website_url" text,
  "favicon_url" text,
  "cache_ttl_preference" varchar(10),
  "context_1m_preference" varchar(20),
  "tpm" integer DEFAULT 0,
  "rpm" integer DEFAULT 0,
  "rpd" integer DEFAULT 0,
  "cc" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vendor_keys_vendor_endpoint" ON "vendor_keys" USING btree ("vendor_id","endpoint_id","is_enabled") WHERE "vendor_keys"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_keys_group" ON "vendor_keys" USING btree ("group_tag") WHERE "vendor_keys"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_keys_created_at" ON "vendor_keys" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_keys_deleted_at" ON "vendor_keys" USING btree ("deleted_at");
--> statement-breakpoint

-- vendor_balance_checks
CREATE TABLE IF NOT EXISTS "vendor_balance_checks" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_key_id" integer NOT NULL,
  "vendor_id" integer,
  "endpoint_id" integer,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "duration_ms" integer,
  "status_code" integer,
  "is_success" boolean DEFAULT false NOT NULL,
  "balance_usd" numeric(21, 6),
  "raw_response" jsonb,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vendor_balance_checks_key_checked_at" ON "vendor_balance_checks" USING btree ("vendor_key_id","checked_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendor_balance_checks_vendor_checked_at" ON "vendor_balance_checks" USING btree ("vendor_id","checked_at" DESC NULLS LAST);
--> statement-breakpoint

-- model_prices_v2
CREATE TABLE IF NOT EXISTS "model_prices_v2" (
  "id" serial PRIMARY KEY NOT NULL,
  "model_name" varchar NOT NULL,
  "price_data" jsonb NOT NULL,
  "source" "model_price_source_v2" NOT NULL,
  "is_user_override" boolean DEFAULT false NOT NULL,
  "remote_version" varchar(64),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_model_prices_v2_latest" ON "model_prices_v2" USING btree ("model_name","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_v2_model_name" ON "model_prices_v2" USING btree ("model_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_v2_source" ON "model_prices_v2" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_v2_created_at" ON "model_prices_v2" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint

-- remote_config_sync
CREATE TABLE IF NOT EXISTS "remote_config_sync" (
  "id" serial PRIMARY KEY NOT NULL,
  "config_key" varchar(64) NOT NULL,
  "remote_version" varchar(64),
  "last_attempt_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone,
  "last_error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unique_remote_config_sync_key" ON "remote_config_sync" USING btree ("config_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_remote_config_sync_updated_at" ON "remote_config_sync" USING btree ("updated_at" DESC NULLS LAST);
--> statement-breakpoint

-- 数据迁移脚本（providers -> vendor_keys）
-- 说明：按 provider 1:1 创建 vendor 与 endpoint，所有迁移数据标记 is_user_override = true

INSERT INTO "vendors" (
  "slug",
  "name",
  "description",
  "category",
  "is_managed",
  "is_enabled",
  "website_url",
  "favicon_url",
  "created_at",
  "updated_at",
  "deleted_at"
)
SELECT
  CONCAT('provider-', p."id"),
  p."name",
  p."description",
  'self_hosted',
  false,
  p."is_enabled",
  p."website_url",
  p."favicon_url",
  p."created_at",
  p."updated_at",
  p."deleted_at"
FROM "providers" p
WHERE NOT EXISTS (
  SELECT 1
  FROM "vendors" v
  WHERE v."slug" = CONCAT('provider-', p."id")
);
--> statement-breakpoint

INSERT INTO "vendor_endpoints" (
  "vendor_id",
  "name",
  "url",
  "api_format",
  "is_enabled",
  "created_at",
  "updated_at",
  "deleted_at"
)
SELECT
  v."id",
  p."name",
  p."url",
  CASE
    WHEN p."provider_type" IN ('claude', 'claude-auth') THEN 'claude'::"vendor_api_format"
    WHEN p."provider_type" IN ('gemini', 'gemini-cli') THEN 'gemini'::"vendor_api_format"
    ELSE 'codex'::"vendor_api_format"
  END,
  p."is_enabled",
  p."created_at",
  p."updated_at",
  p."deleted_at"
FROM "providers" p
JOIN "vendors" v ON v."slug" = CONCAT('provider-', p."id")
WHERE NOT EXISTS (
  SELECT 1
  FROM "vendor_endpoints" e
  WHERE e."vendor_id" = v."id" AND e."url" = p."url"
);
--> statement-breakpoint

INSERT INTO "vendor_keys" (
  "vendor_id",
  "endpoint_id",
  "is_user_override",

  "name",
  "description",
  "url",
  "key",
  "is_enabled",
  "weight",
  "priority",
  "cost_multiplier",
  "group_tag",
  "provider_type",
  "preserve_client_ip",
  "model_redirects",
  "allowed_models",
  "join_claude_pool",
  "codex_instructions_strategy",
  "mcp_passthrough_type",
  "mcp_passthrough_url",
  "limit_5h_usd",
  "limit_daily_usd",
  "daily_reset_mode",
  "daily_reset_time",
  "limit_weekly_usd",
  "limit_monthly_usd",
  "limit_concurrent_sessions",
  "max_retry_attempts",
  "circuit_breaker_failure_threshold",
  "circuit_breaker_open_duration",
  "circuit_breaker_half_open_success_threshold",
  "proxy_url",
  "proxy_fallback_to_direct",
  "first_byte_timeout_streaming_ms",
  "streaming_idle_timeout_ms",
  "request_timeout_non_streaming_ms",
  "website_url",
  "favicon_url",
  "cache_ttl_preference",
  "context_1m_preference",
  "tpm",
  "rpm",
  "rpd",
  "cc",
  "created_at",
  "updated_at",
  "deleted_at"
)
SELECT
  v."id",
  e."id",
  true,

  p."name",
  p."description",
  p."url",
  p."key",
  p."is_enabled",
  p."weight",
  p."priority",
  p."cost_multiplier",
  p."group_tag",
  p."provider_type",
  p."preserve_client_ip",
  p."model_redirects",
  p."allowed_models",
  p."join_claude_pool",
  p."codex_instructions_strategy",
  p."mcp_passthrough_type",
  p."mcp_passthrough_url",
  p."limit_5h_usd",
  p."limit_daily_usd",
  p."daily_reset_mode",
  p."daily_reset_time",
  p."limit_weekly_usd",
  p."limit_monthly_usd",
  p."limit_concurrent_sessions",
  p."max_retry_attempts",
  p."circuit_breaker_failure_threshold",
  p."circuit_breaker_open_duration",
  p."circuit_breaker_half_open_success_threshold",
  p."proxy_url",
  p."proxy_fallback_to_direct",
  p."first_byte_timeout_streaming_ms",
  p."streaming_idle_timeout_ms",
  p."request_timeout_non_streaming_ms",
  p."website_url",
  p."favicon_url",
  p."cache_ttl_preference",
  p."context_1m_preference",
  p."tpm",
  p."rpm",
  p."rpd",
  p."cc",
  p."created_at",
  p."updated_at",
  p."deleted_at"
FROM "providers" p
JOIN "vendors" v ON v."slug" = CONCAT('provider-', p."id")
JOIN "vendor_endpoints" e ON e."vendor_id" = v."id" AND e."url" = p."url"
WHERE NOT EXISTS (
  SELECT 1
  FROM "vendor_keys" k
  WHERE k."vendor_id" = v."id" AND k."endpoint_id" = e."id"
);

