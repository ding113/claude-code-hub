-- Add `endpoint` to the three usage_ledger SUM(cost_usd) covering indexes so the
-- LEDGER_BILLING_CONDITION non-billing-endpoint filter stays index-only (regression from #1091).
--
-- usage_ledger is a high-write table. A plain CREATE INDEX holds a SHARE lock that
-- blocks writes for the whole rebuild, and Drizzle's migrator runs inside a
-- transaction so CREATE INDEX CONCURRENTLY cannot be inlined here.
--
-- To rebuild without write-blocking on a large / busy database, run the following
-- BEFORE this migration (psql, outside a transaction), once per index -- example
-- for idx_usage_ledger_user_cost_cover:
--   DROP INDEX CONCURRENTLY IF EXISTS "idx_usage_ledger_user_cost_cover";
--   CREATE INDEX CONCURRENTLY "idx_usage_ledger_user_cost_cover"
--     ON "usage_ledger" ("user_id","created_at","cost_usd","endpoint")
--     WHERE "blocked_by" IS NULL;
-- The guarded blocks below detect the already-fixed shape via pg_indexes and
-- become a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_usage_ledger_key_cost' AND indexdef LIKE '%endpoint%'
  ) THEN
    DROP INDEX IF EXISTS "idx_usage_ledger_key_cost";
    CREATE INDEX IF NOT EXISTS "idx_usage_ledger_key_cost" ON "usage_ledger" USING btree ("key","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_usage_ledger_user_cost_cover' AND indexdef LIKE '%endpoint%'
  ) THEN
    DROP INDEX IF EXISTS "idx_usage_ledger_user_cost_cover";
    CREATE INDEX IF NOT EXISTS "idx_usage_ledger_user_cost_cover" ON "usage_ledger" USING btree ("user_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_usage_ledger_provider_cost_cover' AND indexdef LIKE '%endpoint%'
  ) THEN
    DROP INDEX IF EXISTS "idx_usage_ledger_provider_cost_cover";
    CREATE INDEX IF NOT EXISTS "idx_usage_ledger_provider_cost_cover" ON "usage_ledger" USING btree ("final_provider_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;
  END IF;
END $$;
