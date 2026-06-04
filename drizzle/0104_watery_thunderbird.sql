ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "hedge_losers" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "bill_hedge_losers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Teach the ledger finalization + success-rate functions about the new hedge_loser_billed
-- reason (a billed racing loser), so a request whose last chain entry is a billed loser
-- still finalizes and is excluded from per-provider success-rate (same as hedge_loser_cancelled).
-- Mirror of src/lib/ledger-backfill/trigger.sql.
CREATE OR REPLACE FUNCTION fn_is_message_request_finalized(
  blocked_by varchar,
  status_code integer,
  provider_chain jsonb,
  error_message text
)
RETURNS boolean AS $$
DECLARE
  last_reason text;
  last_status_code integer;
  last_error_message text;
BEGIN
  IF blocked_by IS NOT NULL THEN
    RETURN TRUE;
  END IF;

  IF status_code IS NOT NULL THEN
    RETURN TRUE;
  END IF;

  IF error_message IS NOT NULL AND error_message <> '' THEN
    RETURN TRUE;
  END IF;

  IF provider_chain IS NOT NULL
     AND jsonb_typeof(provider_chain) = 'array'
     AND jsonb_array_length(provider_chain) > 0
     AND jsonb_typeof(provider_chain -> -1) = 'object' THEN
    last_reason := provider_chain -> -1 ->> 'reason';
    IF (provider_chain -> -1 ? 'statusCode')
       AND jsonb_typeof(provider_chain -> -1 -> 'statusCode') = 'number' THEN
      last_status_code := (provider_chain -> -1 ->> 'statusCode')::integer;
    END IF;
    last_error_message := provider_chain -> -1 ->> 'errorMessage';

    IF last_reason IN (
      'request_success',
      'retry_success',
      'retry_failed',
      'system_error',
      'resource_not_found',
      'client_error_non_retryable',
      'concurrent_limit_failed',
      'hedge_winner',
      'hedge_loser_cancelled',
      'hedge_loser_billed',
      'client_abort'
    )
    OR last_status_code IS NOT NULL
    OR COALESCE(last_error_message, '') <> '' THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION fn_compute_message_request_success_rate_outcome(
  blocked_by varchar,
  status_code integer,
  error_message text,
  provider_chain jsonb
)
RETURNS varchar AS $$
DECLARE
  last_reason text;
  last_status_code integer;
  last_error_message text;
  normalized_error text;
  has_matched_rule boolean := false;
BEGIN
  IF NOT fn_is_message_request_finalized(blocked_by, status_code, provider_chain, error_message) THEN
    RETURN NULL;
  END IF;

  IF blocked_by IS NOT NULL THEN
    RETURN 'excluded';
  END IF;

  IF provider_chain IS NOT NULL
     AND jsonb_typeof(provider_chain) = 'array'
     AND jsonb_array_length(provider_chain) > 0
     AND jsonb_typeof(provider_chain -> -1) = 'object' THEN
    last_reason := provider_chain -> -1 ->> 'reason';
    IF (provider_chain -> -1 ? 'statusCode')
       AND jsonb_typeof(provider_chain -> -1 -> 'statusCode') = 'number' THEN
      last_status_code := (provider_chain -> -1 ->> 'statusCode')::integer;
    END IF;
    last_error_message := provider_chain -> -1 ->> 'errorMessage';
    has_matched_rule := jsonb_typeof(provider_chain -> -1 -> 'errorDetails') = 'object'
      AND (provider_chain -> -1 -> 'errorDetails' ? 'matchedRule');
  END IF;

  IF has_matched_rule THEN
    RETURN 'excluded';
  END IF;

  IF COALESCE(last_status_code, status_code) IN (404, 499) THEN
    RETURN 'excluded';
  END IF;

  IF last_reason IN (
    'resource_not_found',
    'concurrent_limit_failed',
    'hedge_loser_cancelled',
    'hedge_loser_billed',
    'client_error_non_retryable',
    'client_abort'
  ) THEN
    RETURN 'excluded';
  END IF;

  normalized_error := lower(COALESCE(last_error_message, error_message, ''));
  IF normalized_error LIKE '%no available provider%' THEN
    RETURN 'excluded';
  END IF;

  IF normalized_error LIKE '%insufficient quota%'
     OR normalized_error LIKE '%quota exceeded%'
     OR normalized_error LIKE '%rate limit%'
     OR normalized_error LIKE '%rate_limit%'
     OR normalized_error LIKE '%concurrency limit%'
     OR normalized_error LIKE '%concurrent limit%'
     OR normalized_error LIKE '%limit exceeded%' THEN
    RETURN 'excluded';
  END IF;

  IF last_reason IN ('request_success', 'retry_success', 'hedge_winner')
     OR COALESCE(last_status_code, status_code) BETWEEN 200 AND 399 THEN
    RETURN 'success';
  END IF;

  IF last_reason IN (
    'session_reuse',
    'initial_selection',
    'hedge_triggered',
    'hedge_launched',
    'client_restriction_filtered',
    'http2_fallback'
  )
  AND last_status_code IS NULL
  AND COALESCE(last_error_message, error_message, '') = '' THEN
    RETURN NULL;
  END IF;

  RETURN 'failure';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
