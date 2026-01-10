CREATE TABLE IF NOT EXISTS "keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key" varchar NOT NULL,
	"name" varchar NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"expires_at" timestamp,
	"limit_5h_usd" numeric(10, 2),
	"limit_weekly_usd" numeric(10, 2),
	"limit_monthly_usd" numeric(10, 2),
	"limit_concurrent_sessions" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"key" varchar NOT NULL,
	"model" varchar(128),
	"duration_ms" integer,
	"cost_usd" numeric(21, 15) DEFAULT '0',
	"provider_chain" jsonb,
	"status_code" integer,
	"api_type" varchar(20),
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_creation_input_tokens" integer,
	"cache_read_input_tokens" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar NOT NULL,
	"price_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "providers" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"model_redirects" jsonb,
	"limit_5h_usd" numeric(10, 2),
	"limit_weekly_usd" numeric(10, 2),
	"limit_monthly_usd" numeric(10, 2),
	"limit_concurrent_sessions" integer DEFAULT 0,
	"tpm" integer DEFAULT 0,
	"rpm" integer DEFAULT 0,
	"rpd" integer DEFAULT 0,
	"cc" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_title" varchar(128) DEFAULT 'Claude Code Hub' NOT NULL,
	"allow_global_usage_view" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"role" varchar DEFAULT 'user',
	"rpm_limit" integer DEFAULT 60,
	"daily_limit_usd" numeric(10, 2) DEFAULT '100.00',
	"provider_group" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keys_user_id" ON "keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keys_created_at" ON "keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keys_deleted_at" ON "keys" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_user_date_cost" ON "message_request" USING btree ("user_id","created_at","cost_usd") WHERE "message_request"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_user_query" ON "message_request" USING btree ("user_id","created_at") WHERE "message_request"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_provider_id" ON "message_request" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_user_id" ON "message_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_key" ON "message_request" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_created_at" ON "message_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_deleted_at" ON "message_request" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_latest" ON "model_prices" USING btree ("model_name","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_model_name" ON "model_prices" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_created_at" ON "model_prices" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_enabled_priority" ON "providers" USING btree ("is_enabled","priority","weight") WHERE "providers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_group" ON "providers" USING btree ("group_tag") WHERE "providers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_created_at" ON "providers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_deleted_at" ON "providers" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_active_role_sort" ON "users" USING btree ("deleted_at","role","id") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_created_at" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_deleted_at" ON "users" USING btree ("deleted_at");
