CREATE TABLE IF NOT EXISTS "background_task_cursor" (
	"task_key" varchar(128) PRIMARY KEY NOT NULL,
	"cursor_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "ttft_ms" integer;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "timing_semantics_version" integer;--> statement-breakpoint
ALTER TABLE "provider_endpoints" ADD COLUMN IF NOT EXISTS "consecutive_probe_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "session_snapshot_store" varchar(16) DEFAULT 'filesystem' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "ttft_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "timing_semantics_version" integer;--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'message_request'
			AND column_name = 'first_byte_ms'
	) THEN
		EXECUTE $sql$
			UPDATE "message_request"
			SET
				"ttft_ms" = "ttfb_ms",
				"ttfb_ms" = "first_byte_ms",
				"timing_semantics_version" = 2
			WHERE "first_byte_ms" IS NOT NULL
		$sql$;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'usage_ledger'
			AND column_name = 'first_byte_ms'
	) THEN
		EXECUTE $sql$
			UPDATE "usage_ledger"
			SET
				"ttft_ms" = "ttfb_ms",
				"ttfb_ms" = "first_byte_ms",
				"timing_semantics_version" = 2
			WHERE "first_byte_ms" IS NOT NULL
		$sql$;
	END IF;
END
$migration$;--> statement-breakpoint
WITH ranked_windows AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "provider_id", "model", "cache_ttl_bucket", "window_start", "window_end"
			ORDER BY "created_at" DESC NULLS LAST, "id" DESC
		) AS row_number
	FROM "provider_cache_effectiveness"
)
DELETE FROM "provider_cache_effectiveness" AS effectiveness
USING ranked_windows
WHERE effectiveness."id" = ranked_windows."id"
	AND ranked_windows.row_number > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_cache_effectiveness_window" ON "provider_cache_effectiveness" USING btree ("provider_id","model","cache_ttl_bucket","window_start","window_end");--> statement-breakpoint
-- Mirror of src/lib/ledger-backfill/trigger.sql.
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
    duration_ms, ttfb_ms, ttft_ms, timing_semantics_version, client_ip, created_at
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.actual_response_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.status_code, v_is_success, v_success_rate_outcome, NEW.blocked_by,
    NEW.cost_usd, NEW.cost_multiplier, NEW.group_cost_multiplier,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
    NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
    NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied,
    NEW.duration_ms, NEW.ttfb_ms, NEW.ttft_ms, NEW.timing_semantics_version, NEW.client_ip, NEW.created_at
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
    ttft_ms = EXCLUDED.ttft_ms,
    timing_semantics_version = EXCLUDED.timing_semantics_version,
    client_ip = EXCLUDED.client_ip;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_upsert_usage_ledger ON message_request;--> statement-breakpoint
CREATE TRIGGER trg_upsert_usage_ledger
AFTER INSERT OR UPDATE OF
  blocked_by,
  status_code,
  error_message,
  provider_chain,
  actual_response_model,
  endpoint,
  provider_id,
  user_id,
  "key",
  model,
  original_model,
  api_type,
  session_id,
  cost_usd,
  cost_multiplier,
  group_cost_multiplier,
  input_tokens,
  output_tokens,
  cache_creation_input_tokens,
  cache_read_input_tokens,
  cache_creation_5m_input_tokens,
  cache_creation_1h_input_tokens,
  cache_ttl_applied,
  context_1m_applied,
  swap_cache_ttl_applied,
  duration_ms,
  ttfb_ms,
  ttft_ms,
  timing_semantics_version,
  client_ip,
  created_at
ON message_request
FOR EACH ROW
EXECUTE FUNCTION fn_upsert_usage_ledger();--> statement-breakpoint
ALTER TABLE "message_request" DROP COLUMN IF EXISTS "first_byte_ms";--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP COLUMN IF EXISTS "first_byte_ms";
