ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "actual_response_model" varchar(128);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "actual_response_model" varchar(128);--> statement-breakpoint
-- Update fn_upsert_usage_ledger trigger to propagate actual_response_model
-- from message_request to usage_ledger. Mirror of src/lib/ledger-backfill/trigger.sql.
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
    UPDATE usage_ledger
    SET blocked_by = 'warmup',
        success_rate_outcome = v_success_rate_outcome
    WHERE request_id = NEW.id;
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
    model, original_model, actual_response_model, endpoint, api_type, session_id,
    status_code, is_success, success_rate_outcome, blocked_by,
    cost_usd, cost_multiplier, group_cost_multiplier,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
    duration_ms, ttfb_ms, client_ip, created_at
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.actual_response_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.status_code, v_is_success, v_success_rate_outcome, NEW.blocked_by,
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
    client_ip = EXCLUDED.client_ip;
    -- created_at deliberately NOT updated on conflict: it represents the
    -- original insert time of the ledger row, which is immutable by design.

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
