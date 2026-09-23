-- runMigrations() builds these indexes with CREATE INDEX CONCURRENTLY before this migration runs,
-- so IF NOT EXISTS skips them there. Migrations applied outside runMigrations() create them here,
-- and stop when an index is missing on a table larger than 64 MiB, because a plain CREATE INDEX
-- blocks writes to that table until it finishes. The error lists the concurrent statements to run first.
DO $$
DECLARE
  concurrent_statements text;
BEGIN
  SELECT string_agg(format('CREATE INDEX CONCURRENTLY %I %s;', spec.index_name, spec.definition), E'\n' ORDER BY spec.ordinal)
  INTO concurrent_statements
  FROM (VALUES
    (1, 'message_request', 'idx_message_request_session_identity_prefix', 'ON "public"."message_request" USING btree ((COALESCE("session_identity", "session_id")) varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> ''warmup'')'),
    (2, 'message_request', 'idx_message_request_session_id_prefix_cover', 'ON "public"."message_request" USING btree ("session_id" varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> ''warmup'')'),
    (3, 'usage_ledger', 'idx_usage_ledger_session_identity_prefix', 'ON "public"."usage_ledger" USING btree ((COALESCE("session_identity", "session_id")) varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL'),
    (4, 'usage_ledger', 'idx_usage_ledger_session_id_prefix', 'ON "public"."usage_ledger" USING btree ("session_id" varchar_pattern_ops,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "usage_ledger"."blocked_by" IS NULL')
  ) AS spec(ordinal, table_name, index_name, definition)
  WHERE to_regclass(format('public.%I', spec.index_name)) IS NULL
    AND pg_relation_size(format('public.%I', spec.table_name)::regclass) > 64 * 1024 * 1024;

  IF concurrent_statements IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0122 would block writes while building session prefix indexes on large tables'
      USING DETAIL = E'Build them without blocking writes, then rerun this migration:\n' || concurrent_statements,
            HINT = 'runMigrations() (AUTO_MIGRATE=true or bun run db:migrate) builds these indexes with CREATE INDEX CONCURRENTLY automatically.';
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
