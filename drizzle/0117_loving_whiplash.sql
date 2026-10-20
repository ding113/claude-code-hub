CREATE INDEX IF NOT EXISTS "idx_usage_ledger_session_identity" ON "usage_ledger" USING btree (COALESCE("session_identity", "session_id"));
