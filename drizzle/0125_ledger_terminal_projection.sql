-- Ledger projection only for finalized message_request rows, and skip batched updates whose
-- projected columns did not change. Canonical copy: src/lib/ledger-backfill/trigger.sql.
--
-- Effect: a normal request writes one usage_ledger row at completion instead of an insert at
-- request start plus one upsert per batched update. In-flight requests appear in usage_ledger
-- only once they finish; abandoned rows are filled by the ledger backfill.
--
-- Rollback: re-apply the fn_upsert_usage_ledger function definition from
-- drizzle/0116_gigantic_zombie.sql (idempotent, journal untouched), then run the ledger backfill.
CREATE OR REPLACE FUNCTION fn_upsert_usage_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_final_provider_id integer;
  v_is_success boolean;
  v_success_rate_outcome varchar;
BEGIN
  -- Gate 1: only finalized requests are projected. An in-flight INSERT (and in-flight metadata
  -- updates) no longer write a ledger row that is rewritten again at completion. Every
  -- finalization changes at least one of blocked_by/status_code/error_message/provider_chain,
  -- all of which are in the trigger column list, so the finalizing UPDATE always reaches the
  -- upsert below. Rows abandoned before finalization are filled by the ledger backfill.
  IF NOT fn_is_message_request_finalized(
    NEW.blocked_by,
    NEW.status_code,
    NEW.provider_chain,
    NEW.error_message
  ) THEN
    RETURN NEW;
  END IF;

  -- Gate 2: batched CASE updates list every patched column for every row of the batch, which
  -- fires this trigger for rows whose projected values did not change. Skip those rows. The
  -- compared columns are exactly the trigger's UPDATE OF column list.
  IF TG_OP = 'UPDATE' AND
    ROW(NEW.blocked_by, NEW.status_code, NEW.error_message, NEW.provider_chain,
        NEW.actual_response_model, NEW.endpoint, NEW.provider_id, NEW.user_id, NEW."key",
        NEW.model, NEW.original_model, NEW.api_type, NEW.session_id, NEW.session_identity,
        NEW.session_identity_kind, NEW.affinity_scope_tag, NEW.affinity_fingerprint,
        NEW.affinity_fingerprint_chain, NEW.is_replay, NEW.replay_source_request_id, NEW.cost_usd,
        NEW.cost_multiplier, NEW.group_cost_multiplier, NEW.input_tokens, NEW.output_tokens,
        NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
        NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
        NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied, NEW.duration_ms,
        NEW.ttfb_ms, NEW.first_byte_ms, NEW.client_ip, NEW.created_at)
    IS NOT DISTINCT FROM
    ROW(OLD.blocked_by, OLD.status_code, OLD.error_message, OLD.provider_chain,
        OLD.actual_response_model, OLD.endpoint, OLD.provider_id, OLD.user_id, OLD."key",
        OLD.model, OLD.original_model, OLD.api_type, OLD.session_id, OLD.session_identity,
        OLD.session_identity_kind, OLD.affinity_scope_tag, OLD.affinity_fingerprint,
        OLD.affinity_fingerprint_chain, OLD.is_replay, OLD.replay_source_request_id, OLD.cost_usd,
        OLD.cost_multiplier, OLD.group_cost_multiplier, OLD.input_tokens, OLD.output_tokens,
        OLD.cache_creation_input_tokens, OLD.cache_read_input_tokens,
        OLD.cache_creation_5m_input_tokens, OLD.cache_creation_1h_input_tokens,
        OLD.cache_ttl_applied, OLD.context_1m_applied, OLD.swap_cache_ttl_applied, OLD.duration_ms,
        OLD.ttfb_ms, OLD.first_byte_ms, OLD.client_ip, OLD.created_at) THEN
    RETURN NEW;
  END IF;

  v_success_rate_outcome := fn_compute_message_request_success_rate_outcome(
    NEW.blocked_by,
    NEW.status_code,
    NEW.error_message,
    NEW.provider_chain
  );

  IF NEW.blocked_by = 'warmup' THEN
    -- If a ledger row already exists (row was originally non-warmup), mark it as warmup
    -- and sync the latest actual_response_model so audit stays consistent across tables.
    -- On INSERT no ledger row can exist yet, but the early RETURN still applies so warmup
    -- rows never reach the upsert.
    IF TG_OP = 'UPDATE' THEN
      UPDATE usage_ledger
      SET blocked_by = 'warmup',
          success_rate_outcome = v_success_rate_outcome,
          actual_response_model = NEW.actual_response_model
      WHERE request_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF LOWER(REGEXP_REPLACE(COALESCE(NEW.endpoint, ''), '/+$', ''))
    IN ('/v1/messages/count_tokens', '/v1/responses/compact') THEN
    -- Non-billing endpoints never keep a ledger row. On INSERT there is nothing to delete, but
    -- the early RETURN still applies.
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM usage_ledger WHERE request_id = NEW.id;
    END IF;
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
    session_identity, session_identity_kind, affinity_scope_tag,
    affinity_fingerprint, affinity_fingerprint_chain, is_replay, replay_source_request_id,
    status_code, is_success, success_rate_outcome, blocked_by,
    cost_usd, cost_multiplier, group_cost_multiplier,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
    duration_ms, ttfb_ms, first_byte_ms, client_ip, created_at
  ) VALUES (
    NEW.id, NEW.user_id, NEW.key, NEW.provider_id, v_final_provider_id,
    NEW.model, NEW.original_model, NEW.actual_response_model, NEW.endpoint, NEW.api_type, NEW.session_id,
    NEW.session_identity, NEW.session_identity_kind, NEW.affinity_scope_tag,
    NEW.affinity_fingerprint, NEW.affinity_fingerprint_chain, NEW.is_replay, NEW.replay_source_request_id,
    NEW.status_code, v_is_success, v_success_rate_outcome, NEW.blocked_by,
    CASE WHEN NEW.is_replay THEN 0 ELSE NEW.cost_usd END,
    NEW.cost_multiplier, NEW.group_cost_multiplier,
    NEW.input_tokens, NEW.output_tokens,
    NEW.cache_creation_input_tokens, NEW.cache_read_input_tokens,
    NEW.cache_creation_5m_input_tokens, NEW.cache_creation_1h_input_tokens,
    NEW.cache_ttl_applied, NEW.context_1m_applied, NEW.swap_cache_ttl_applied,
    NEW.duration_ms, NEW.ttfb_ms, NEW.first_byte_ms, NEW.client_ip, NEW.created_at
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
    session_identity = EXCLUDED.session_identity,
    session_identity_kind = EXCLUDED.session_identity_kind,
    affinity_scope_tag = EXCLUDED.affinity_scope_tag,
    affinity_fingerprint = EXCLUDED.affinity_fingerprint,
    affinity_fingerprint_chain = EXCLUDED.affinity_fingerprint_chain,
    is_replay = EXCLUDED.is_replay,
    replay_source_request_id = EXCLUDED.replay_source_request_id,
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
    first_byte_ms = EXCLUDED.first_byte_ms,
    client_ip = EXCLUDED.client_ip;
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
  session_identity,
  session_identity_kind,
  affinity_scope_tag,
  affinity_fingerprint,
  affinity_fingerprint_chain,
  is_replay,
  replay_source_request_id,
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
  first_byte_ms,
  client_ip,
  created_at
ON message_request
FOR EACH ROW
EXECUTE FUNCTION fn_upsert_usage_ledger();
