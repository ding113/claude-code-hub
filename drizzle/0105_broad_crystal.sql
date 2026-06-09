DO $$ BEGIN
	CREATE TYPE "public"."boost_window" AS ENUM('5h', 'daily', 'weekly', 'monthly', 'total');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."limit_subject" AS ENUM('user', 'key', 'user_group');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_group_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" "limit_subject" NOT NULL,
	"subject_id" integer NOT NULL,
	"model_group_id" integer NOT NULL,
	"rpm_limit" integer,
	"limit_5h_usd" numeric(10, 2),
	"limit_5h_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL,
	"daily_limit_usd" numeric(10, 2),
	"limit_weekly_usd" numeric(10, 2),
	"limit_monthly_usd" numeric(10, 2),
	"limit_total_usd" numeric(10, 2),
	"limit_5h_cost_reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_group_id" integer NOT NULL,
	"model" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"is_singleton" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_boost_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model_group_id" integer NOT NULL,
	"window" "boost_window" NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" varchar(255) NOT NULL,
	"name" varchar(128),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "counted_in_user_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "counted_in_key_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "quota_model_lease_percent_5h" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "quota_model_lease_percent_daily" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "quota_model_lease_percent_weekly" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "quota_model_lease_percent_monthly" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "quota_model_lease_min_slice_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "counted_in_user_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "counted_in_key_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "model_group_limits" ADD CONSTRAINT "model_group_limits_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "model_group_members" ADD CONSTRAINT "model_group_members_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quota_boost_grants" ADD CONSTRAINT "quota_boost_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quota_boost_grants" ADD CONSTRAINT "quota_boost_grants_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_group_limits_uniq_idx" ON "model_group_limits" USING btree ("subject_type","subject_id","model_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_limits_subject_idx" ON "model_group_limits" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_limits_group_idx" ON "model_group_limits" USING btree ("model_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_group_members_model_idx" ON "model_group_members" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_members_group_idx" ON "model_group_members" USING btree ("model_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_groups_name_idx" ON "model_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_boost_grants_target_idx" ON "quota_boost_grants" USING btree ("user_id","model_group_id","window");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_boost_grants_valid_to_idx" ON "quota_boost_grants" USING btree ("valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_groups_tag_idx" ON "user_groups" USING btree ("tag");--> statement-breakpoint
-- Update fn_upsert_usage_ledger so the new message_request.counted_in_*_global
-- markers are copied into usage_ledger. Without this the installed trigger (from
-- an earlier migration) keeps writing the defaults (true) on the ledger row, so a
-- model-split request marked counted=false on message_request would still be
-- counted globally in DB/lease aggregations. Mirror of src/lib/ledger-backfill/trigger.sql.
CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_final_provider_id integer;
  v_is_success boolean;
  v_success_rate_outcome varchar;
BEGIN
  v_success_rate_outcome := fn_compute_message_request_success_rate_outcome(
    NEW.blocked_by,
    NEW.status_code,
    NEW.error_message,
    NEW.provider_chain
  );

  IF NEW.blocked_by = 'warmup' THEN
    -- If a ledger row already exists (row was originally non-warmup), mark it as warmup
    -- and sync the latest actual_response_model so audit stays consistent across tables.
    UPDATE usage_ledger
    SET blocked_by = 'warmup',
        success_rate_outcome = v_success_rate_outcome,
        actual_response_model = NEW.actual_response_model
    WHERE request_id = NEW.id;
    RETURN NEW;
  END IF;

  IF LOWER(REGEXP_REPLACE(COALESCE(NEW.endpoint, ''), '/+$', ''))
    IN ('/v1/messages/count_tokens', '/v1/responses/compact') THEN
    DELETE FROM usage_ledger WHERE request_id = NEW.id;
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

  v_is_success := (NEW.error_message IS NULL OR NEW.error_message = '')
                  AND (NEW.status_code IS NULL OR NEW.status_code < 400);

  INSERT INTO usage_ledger (
    request_id, user_id, key, provider_id, final_provider_id,
    model, original_model, actual_response_model, endpoint, api_type, session_id,
    status_code, is_success, success_rate_outcome, blocked_by,
    cost_usd, cost_multiplier, group_cost_multiplier,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
    duration_ms, ttfb_ms, client_ip, created_at,
    counted_in_user_global, counted_in_key_global
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.actual_response_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.status_code, v_is_success, v_success_rate_outcome, NEW.blocked_by,
    NEW.cost_usd, NEW.cost_multiplier, NEW.group_cost_multiplier,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
    NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
    NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied,
    NEW.duration_ms, NEW.ttfb_ms, NEW.client_ip, NEW.created_at,
    COALESCE(NEW.counted_in_user_global, true), COALESCE(NEW.counted_in_key_global, true)
  )
  ON CONFLICT (request_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    key = EXCLUDED.key,
    provider_id = EXCLUDED.provider_id,
    final_provider_id = EXCLUDED.final_provider_id,
    model = EXCLUDED.model,
    original_model = EXCLUDED.original_model,
    actual_response_model = EXCLUDED.actual_response_model,
    endpoint = EXCLUDED.endpoint,
    api_type = EXCLUDED.api_type,
    session_id = EXCLUDED.session_id,
    status_code = EXCLUDED.status_code,
    is_success = EXCLUDED.is_success,
    success_rate_outcome = EXCLUDED.success_rate_outcome,
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
    counted_in_user_global = EXCLUDED.counted_in_user_global,
    counted_in_key_global = EXCLUDED.counted_in_key_global;
    -- created_at deliberately NOT updated on conflict: it represents the
    -- original insert time of the ledger row, which is immutable by design.

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_upsert_usage_ledger ON message_request;--> statement-breakpoint
CREATE TRIGGER trg_upsert_usage_ledger
AFTER INSERT OR UPDATE ON message_request
FOR EACH ROW
EXECUTE FUNCTION fn_upsert_usage_ledger();