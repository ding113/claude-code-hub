CREATE TABLE IF NOT EXISTS "usage_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"key" varchar NOT NULL,
	"provider_id" integer NOT NULL,
	"final_provider_id" integer NOT NULL,
	"model" varchar(128),
	"original_model" varchar(128),
	"endpoint" varchar(256),
	"api_type" varchar(20),
	"session_id" varchar(64),
	"status_code" integer,
	"is_success" boolean DEFAULT false NOT NULL,
	"blocked_by" varchar(50),
	"cost_usd" numeric(21, 15) DEFAULT '0',
	"cost_multiplier" numeric(10, 4),
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cache_creation_input_tokens" bigint,
	"cache_read_input_tokens" bigint,
	"cache_creation_5m_input_tokens" bigint,
	"cache_creation_1h_input_tokens" bigint,
	"cache_ttl_applied" varchar(10),
	"context_1m_applied" boolean DEFAULT false,
	"swap_cache_ttl_applied" boolean DEFAULT false,
	"duration_ms" integer,
	"ttfb_ms" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_usage_ledger_request_id" ON "usage_ledger" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_user_created_at" ON "usage_ledger" USING btree ("user_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_key_created_at" ON "usage_ledger" USING btree ("key","created_at") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_provider_created_at" ON "usage_ledger" USING btree ("final_provider_id","created_at") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_created_at_minute" ON "usage_ledger" USING btree (date_trunc('minute', "created_at" AT TIME ZONE 'UTC'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_created_at_desc_id" ON "usage_ledger" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_session_id" ON "usage_ledger" USING btree ("session_id") WHERE "usage_ledger"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_model" ON "usage_ledger" USING btree ("model") WHERE "usage_ledger"."model" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_key_cost" ON "usage_ledger" USING btree ("key","cost_usd") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint

-- Trigger: auto-upsert usage_ledger on message_request INSERT/UPDATE
CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_final_provider_id integer;
  v_is_success boolean;
BEGIN
  IF NEW.blocked_by = 'warmup' THEN
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
    cost_usd, cost_multiplier,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
    duration_ms, ttfb_ms, created_at
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.status_code, v_is_success, NEW.blocked_by,
    NEW.cost_usd, NEW.cost_multiplier,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
    NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
    NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied,
    NEW.duration_ms, NEW.ttfb_ms, NEW.created_at
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
    created_at = EXCLUDED.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_upsert_usage_ledger
AFTER INSERT OR UPDATE ON message_request
FOR EACH ROW
EXECUTE FUNCTION fn_upsert_usage_ledger();