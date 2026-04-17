CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_category" varchar(32) NOT NULL,
	"action_type" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"target_name" varchar(256),
	"before_value" jsonb,
	"after_value" jsonb,
	"operator_user_id" integer,
	"operator_user_name" varchar(128),
	"operator_key_id" integer,
	"operator_key_name" varchar(128),
	"operator_ip" varchar(45),
	"user_agent" varchar(512),
	"success" boolean NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"cost_multiplier" numeric(10, 4) DEFAULT '1.0' NOT NULL,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "provider_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "group_cost_multiplier" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cost_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "client_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "ip_extraction_config" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "ip_geo_lookup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "group_cost_multiplier" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "client_ip" varchar(45);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_category_created_at" ON "audit_log" USING btree ("action_category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_operator_user_created_at" ON "audit_log" USING btree ("operator_user_id","created_at" DESC NULLS LAST) WHERE "audit_log"."operator_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_operator_ip_created_at" ON "audit_log" USING btree ("operator_ip","created_at" DESC NULLS LAST) WHERE "audit_log"."operator_ip" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_target" ON "audit_log" USING btree ("target_type","target_id") WHERE "audit_log"."target_type" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_created_at_id" ON "audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_client_ip_created_at" ON "message_request" USING btree ("client_ip","created_at" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND "message_request"."client_ip" IS NOT NULL;--> statement-breakpoint
-- Update fn_upsert_usage_ledger trigger to propagate client_ip and group_cost_multiplier
-- from message_request to usage_ledger. Mirror of src/lib/ledger-backfill/trigger.sql.
CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_final_provider_id integer;
  v_is_success boolean;
BEGIN
  IF NEW.blocked_by = 'warmup' THEN
    UPDATE usage_ledger SET blocked_by = 'warmup' WHERE request_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.provider_chain IS NOT NULL
     AND jsonb_typeof(NEW.provider_chain) = 'array'
     AND jsonb_array_length(NEW.provider_chain) > 0
     AND jsonb_typeof(NEW.provider_chain -> -1) = 'object'
     AND (NEW.provider_chain -> -1 ? 'id')
     AND (NEW.provider_chain -> -1 ->> 'id') ~ '^[0-9]+$' THEN
    v_final_provider_id := (NEW.provider_chain -> -1 ->> 'id')::integer;
  ELSE
    v_final_provider_id := NEW.provider_id;
  END IF;

  v_is_success := (NEW.error_message IS NULL OR NEW.error_message = '');

  INSERT INTO usage_ledger (
    request_id, user_id, key, provider_id, final_provider_id,
    model, original_model, endpoint, api_type, session_id,
    status_code, is_success, blocked_by,
    cost_usd, cost_multiplier, group_cost_multiplier,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
    duration_ms, ttfb_ms, client_ip, created_at
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.status_code, v_is_success, NEW.blocked_by,
    NEW.cost_usd, NEW.cost_multiplier, NEW.group_cost_multiplier,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
    NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
    NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied,
    NEW.duration_ms, NEW.ttfb_ms, NEW.client_ip, NEW.created_at
  )
  ON CONFLICT (request_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    key = EXCLUDED.key,
    provider_id = EXCLUDED.provider_id,
    final_provider_id = EXCLUDED.final_provider_id,
    model = EXCLUDED.model,
    original_model = EXCLUDED.original_model,
    endpoint = EXCLUDED.endpoint,
    api_type = EXCLUDED.api_type,
    session_id = EXCLUDED.session_id,
    status_code = EXCLUDED.status_code,
    is_success = EXCLUDED.is_success,
    blocked_by = EXCLUDED.blocked_by,
    cost_usd = EXCLUDED.cost_usd,
    cost_multiplier = EXCLUDED.cost_multiplier,
    group_cost_multiplier = EXCLUDED.group_cost_multiplier,
    input_tokens = EXCLUDED.input_tokens,
    output_tokens = EXCLUDED.output_tokens,
    cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
    cache_read_input_tokens = EXCLUDED.cache_read_input_tokens,
    cache_creation_5m_input_tokens = EXCLUDED.cache_creation_5m_input_tokens,
    cache_creation_1h_input_tokens = EXCLUDED.cache_creation_1h_input_tokens,
    cache_ttl_applied = EXCLUDED.cache_ttl_applied,
    context_1m_applied = EXCLUDED.context_1m_applied,
    swap_cache_ttl_applied = EXCLUDED.swap_cache_ttl_applied,
    duration_ms = EXCLUDED.duration_ms,
    ttfb_ms = EXCLUDED.ttfb_ms,
    client_ip = EXCLUDED.client_ip,
    created_at = EXCLUDED.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;