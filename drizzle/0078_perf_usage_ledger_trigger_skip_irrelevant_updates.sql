-- perf: avoid redundant usage_ledger UPSERTs on irrelevant message_request updates

CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_final_provider_id integer;
  v_old_final_provider_id integer;
  v_is_success boolean;
  v_old_is_success boolean;
BEGIN
  IF NEW.blocked_by = 'warmup' THEN
    -- If a ledger row already exists (row was originally non-warmup), mark it as warmup
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

  -- Performance: skip UPSERT when UPDATE doesn't affect usage_ledger fields.
  -- usage_ledger does NOT persist provider_chain / error_message, so compare derived values instead.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.provider_chain IS NOT NULL
       AND jsonb_typeof(OLD.provider_chain) = 'array'
       AND jsonb_array_length(OLD.provider_chain) > 0
       AND jsonb_typeof(OLD.provider_chain -> -1) = 'object'
       AND (OLD.provider_chain -> -1 ? 'id')
       AND (OLD.provider_chain -> -1 ->> 'id') ~ '^[0-9]+$' THEN
      v_old_final_provider_id := (OLD.provider_chain -> -1 ->> 'id')::integer;
    ELSE
      v_old_final_provider_id := OLD.provider_id;
    END IF;

    v_old_is_success := (OLD.error_message IS NULL OR OLD.error_message = '');

    IF
      NEW.user_id IS NOT DISTINCT FROM OLD.user_id
      AND NEW.key IS NOT DISTINCT FROM OLD.key
      AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id
      AND v_final_provider_id IS NOT DISTINCT FROM v_old_final_provider_id
      AND NEW.model IS NOT DISTINCT FROM OLD.model
      AND NEW.original_model IS NOT DISTINCT FROM OLD.original_model
      AND NEW.endpoint IS NOT DISTINCT FROM OLD.endpoint
      AND NEW.api_type IS NOT DISTINCT FROM OLD.api_type
      AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
      AND NEW.status_code IS NOT DISTINCT FROM OLD.status_code
      AND v_is_success IS NOT DISTINCT FROM v_old_is_success
      AND NEW.blocked_by IS NOT DISTINCT FROM OLD.blocked_by
      AND NEW.cost_usd IS NOT DISTINCT FROM OLD.cost_usd
      AND NEW.cost_multiplier IS NOT DISTINCT FROM OLD.cost_multiplier
      AND NEW.input_tokens IS NOT DISTINCT FROM OLD.input_tokens
      AND NEW.output_tokens IS NOT DISTINCT FROM OLD.output_tokens
      AND NEW.cache_creation_input_tokens IS NOT DISTINCT FROM OLD.cache_creation_input_tokens
      AND NEW.cache_read_input_tokens IS NOT DISTINCT FROM OLD.cache_read_input_tokens
      AND NEW.cache_creation_5m_input_tokens IS NOT DISTINCT FROM OLD.cache_creation_5m_input_tokens
      AND NEW.cache_creation_1h_input_tokens IS NOT DISTINCT FROM OLD.cache_creation_1h_input_tokens
      AND NEW.cache_ttl_applied IS NOT DISTINCT FROM OLD.cache_ttl_applied
      AND NEW.context_1m_applied IS NOT DISTINCT FROM OLD.context_1m_applied
      AND NEW.swap_cache_ttl_applied IS NOT DISTINCT FROM OLD.swap_cache_ttl_applied
      AND NEW.duration_ms IS NOT DISTINCT FROM OLD.duration_ms
      AND NEW.ttfb_ms IS NOT DISTINCT FROM OLD.ttfb_ms
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
      -- Self-heal: if prior UPSERT failed and ledger row is missing, allow a later UPDATE to fill it.
      -- Uses cheap indexed read (request_id UNIQUE) to avoid reintroducing write amplification.
      IF EXISTS (SELECT 1 FROM usage_ledger WHERE request_id = NEW.id) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

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
$$ LANGUAGE plpgsql;
