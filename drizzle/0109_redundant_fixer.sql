CREATE TABLE IF NOT EXISTS "provider_cache_effectiveness" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"model" varchar(128) NOT NULL,
	"cache_ttl_bucket" varchar(10) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"theoretical_cache_tokens" bigint DEFAULT 0 NOT NULL,
	"observed_cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"raw_effectiveness_bp" integer DEFAULT 0 NOT NULL,
	"confidence_bp" integer DEFAULT 0 NOT NULL,
	"effectiveness_bp" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "replay_payloads" (
	"replay_id" varchar(64) PRIMARY KEY NOT NULL,
	"verifier" varchar(64) NOT NULL,
	"scope_tag" varchar(16) NOT NULL,
	"key_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"format" varchar(16) NOT NULL,
	"model" varchar(128),
	"status_code" integer NOT NULL,
	"headers_json" jsonb,
	"payload" text NOT NULL,
	"byte_size" integer NOT NULL,
	"source_message_request_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_compatibility_key" varchar(64);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_score_eligible" boolean;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_score_excluded_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "theoretical_cache_tokens" bigint;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_ttl_bucket" varchar(10);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_cache_effectiveness_window" ON "provider_cache_effectiveness" USING btree ("provider_id","model","window_start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_replay_payloads_key_id" ON "replay_payloads" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_replay_payloads_expires_at" ON "replay_payloads" USING btree ("expires_at");