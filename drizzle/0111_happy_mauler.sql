ALTER TABLE "message_request" ADD COLUMN "routing_trace" jsonb;

-- Routing trace finalization is observability-only. Restrict the ledger trigger
-- to columns that can actually change its projection so trace-only patches do
-- not rewrite accounting rows.
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
  client_ip,
  created_at
ON message_request
FOR EACH ROW
EXECUTE FUNCTION fn_upsert_usage_ledger();
