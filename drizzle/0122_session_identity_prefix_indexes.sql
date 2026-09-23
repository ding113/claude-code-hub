-- runMigrations() builds these indexes with CREATE INDEX CONCURRENTLY before this migration runs,
-- so IF NOT EXISTS skips them there. Migrations applied outside runMigrations() create them here,
-- and stop on large tables because a plain CREATE INDEX blocks writes until it finishes.
DO $$
DECLARE
  missing_indexes text[];
BEGIN
  SELECT array_agg(index_name) INTO missing_indexes
  FROM unnest(ARRAY[
    'idx_message_request_session_identity_prefix',
    'idx_message_request_session_id_prefix_cover',
    'idx_usage_ledger_session_identity_prefix',
    'idx_usage_ledger_session_id_prefix'
  ]) AS index_name
  WHERE to_regclass('public.' || quote_ident(index_name)) IS NULL;

  IF missing_indexes IS NOT NULL AND (
    pg_relation_size('public.message_request') > 64 * 1024 * 1024
    OR pg_relation_size('public.usage_ledger') > 64 * 1024 * 1024
  ) THEN
    RAISE EXCEPTION 'Migration 0122 would block writes while building % on large tables', array_to_string(missing_indexes, ', ')
      USING HINT = 'Apply migrations with runMigrations() (AUTO_MIGRATE=true or bun run db:migrate), which builds these indexes with CREATE INDEX CONCURRENTLY first, then rerun this migration.';
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_session_identity_prefix" ON "public"."message_request" USING btree ((COALESCE("session_identity", "session_id")) varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> 'warmup');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_session_id_prefix_cover" ON "public"."message_request" USING btree ("session_id" varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> 'warmup');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_session_identity_prefix" ON "public"."usage_ledger" USING btree ((COALESCE("session_identity", "session_id")) varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_session_id_prefix" ON "public"."usage_ledger" USING btree ("session_id" varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
COMMENT ON INDEX "public"."idx_message_request_session_identity_prefix" IS 'cch:migration:0121:session-identity-prefix-index:v1';--> statement-breakpoint
COMMENT ON INDEX "public"."idx_message_request_session_id_prefix_cover" IS 'cch:migration:0121:session-identity-prefix-index:v1';--> statement-breakpoint
COMMENT ON INDEX "public"."idx_usage_ledger_session_identity_prefix" IS 'cch:migration:0121:session-identity-prefix-index:v1';--> statement-breakpoint
COMMENT ON INDEX "public"."idx_usage_ledger_session_id_prefix" IS 'cch:migration:0121:session-identity-prefix-index:v1';
