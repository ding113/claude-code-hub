-- If write blocking is a concern on a large usage_ledger table, manually pre-create:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_usage_ledger_key_created_at_desc_cover"
--   ON "usage_ledger" USING btree ("key","created_at" DESC NULLS LAST,"final_provider_id")
--   WHERE "usage_ledger"."blocked_by" IS NULL;
-- The IF NOT EXISTS below will then be a no-op.
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_key_created_at_desc_cover" ON "usage_ledger" USING btree ("key","created_at" DESC NULLS LAST,"final_provider_id") WHERE "usage_ledger"."blocked_by" IS NULL;
