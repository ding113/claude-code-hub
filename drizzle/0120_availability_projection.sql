-- Availability projection: outbox + 1-minute buckets (read path no longer scans message_request)
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" bigserial PRIMARY KEY,
  "event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" bigint NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  CONSTRAINT "outbox_events_event_id_key" UNIQUE("event_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_outbox_events_unpublished"
  ON "outbox_events" USING btree ("id" ASC)
  WHERE "published_at" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outbox_processed" (
  "event_id" uuid PRIMARY KEY,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proj_applied_requests" (
  "request_id" bigint PRIMARY KEY,
  "event_id" uuid NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "avail_bucket_1m" (
  "provider_id" integer NOT NULL,
  "bucket_start" timestamp with time zone NOT NULL,
  "success_cnt" integer DEFAULT 0 NOT NULL,
  "failure_cnt" integer DEFAULT 0 NOT NULL,
  "excluded_cnt" integer DEFAULT 0 NOT NULL,
  "latency_cnt" integer DEFAULT 0 NOT NULL,
  "latency_sum_ms" bigint DEFAULT 0 NOT NULL,
  "last_request_at" timestamp with time zone,
  CONSTRAINT "avail_bucket_1m_pkey" PRIMARY KEY("provider_id","bucket_start")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_avail_bucket_1m_time"
  ON "avail_bucket_1m" USING btree ("bucket_start" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "avail_current" (
  "provider_id" integer PRIMARY KEY,
  "state" text DEFAULT 'unknown' NOT NULL,
  "availability" double precision DEFAULT 0 NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  "last_request_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "projection_meta" (
  "key" text PRIMARY KEY,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

INSERT INTO "projection_meta" ("key", "value")
VALUES ('bootstrap', jsonb_build_object('version', 1, 'note', 'availability outbox projections'))
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_message_request_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.status_code IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status_code IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_replay, false) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_outcome := fn_compute_message_request_success_rate_outcome(
      NEW.blocked_by,
      NEW.status_code,
      NEW.error_message,
      NEW.provider_chain
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_message_request_outbox: outcome compute failed for request %: %',
      NEW.id, SQLERRM;
    v_outcome := NULL;
  END;

  IF v_outcome IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO outbox_events (
    event_type, aggregate_type, aggregate_id, occurred_at, payload
  ) VALUES (
    'request_finalized',
    'message_request',
    NEW.id,
    COALESCE(NEW.created_at, now()),
    jsonb_build_object(
      'request_id', NEW.id,
      'provider_id', NEW.provider_id,
      'model', NEW.model,
      'occurred_at', COALESCE(NEW.created_at, now()),
      'status_code', NEW.status_code,
      'duration_ms', NEW.duration_ms,
      'ttfb_ms', NEW.ttfb_ms,
      'blocked_by', NEW.blocked_by,
      'outcome', v_outcome,
      'group_tag', (SELECT group_tag FROM providers p WHERE p.id = NEW.provider_id),
      'is_replay', COALESCE(NEW.is_replay, false)
    )
  );

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS message_request_outbox_aiud ON message_request;--> statement-breakpoint
CREATE TRIGGER message_request_outbox_aiud
  AFTER INSERT OR UPDATE OF status_code, duration_ms, error_message, provider_chain, blocked_by
  ON message_request
  FOR EACH ROW
  EXECUTE FUNCTION trg_message_request_outbox();
