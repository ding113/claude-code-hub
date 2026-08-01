ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "session_identity" varchar(64);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "session_identity_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "affinity_scope_tag" varchar(16);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "affinity_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "affinity_fingerprint_chain" jsonb;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "is_replay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "replay_source_request_id" integer;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "session_identity" varchar(64);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "session_identity_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "affinity_scope_tag" varchar(16);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "affinity_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "affinity_fingerprint_chain" jsonb;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "is_replay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "replay_source_request_id" integer;--> statement-breakpoint

-- Before 0116, Replay audit rows were identified by blocked_by='replay_serve'.
-- Convert that legacy marker to the formal audit fields without inventing unavailable provenance.
UPDATE message_request
SET is_replay = true,
    blocked_by = NULL,
    cost_usd = 0,
    cost_breakdown = NULL
WHERE blocked_by = 'replay_serve';--> statement-breakpoint
UPDATE usage_ledger
SET is_replay = true,
    blocked_by = NULL,
    cost_usd = 0
WHERE blocked_by = 'replay_serve';--> statement-breakpoint

-- Existing ledger rows must receive the same identity and Replay provenance as their source request.
-- Replay cost is normalized at this projection boundary as an additional accounting safeguard.
UPDATE usage_ledger AS ul
SET session_identity = mr.session_identity,
    session_identity_kind = mr.session_identity_kind,
    affinity_scope_tag = mr.affinity_scope_tag,
    affinity_fingerprint = mr.affinity_fingerprint,
    affinity_fingerprint_chain = mr.affinity_fingerprint_chain,
    is_replay = mr.is_replay,
    replay_source_request_id = mr.replay_source_request_id,
    cost_usd = CASE WHEN mr.is_replay THEN 0 ELSE ul.cost_usd END
FROM message_request AS mr
WHERE ul.request_id = mr.id
  AND (
    ul.session_identity IS DISTINCT FROM mr.session_identity
    OR ul.session_identity_kind IS DISTINCT FROM mr.session_identity_kind
    OR ul.affinity_scope_tag IS DISTINCT FROM mr.affinity_scope_tag
    OR ul.affinity_fingerprint IS DISTINCT FROM mr.affinity_fingerprint
    OR ul.affinity_fingerprint_chain IS DISTINCT FROM mr.affinity_fingerprint_chain
    OR ul.is_replay IS DISTINCT FROM mr.is_replay
    OR ul.replay_source_request_id IS DISTINCT FROM mr.replay_source_request_id
    OR (mr.is_replay AND ul.cost_usd IS DISTINCT FROM 0)
  );--> statement-breakpoint

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

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_upsert_usage_ledger failed for request_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_upsert_usage_ledger ON message_request;

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
