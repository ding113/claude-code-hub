DROP INDEX IF EXISTS "idx_usage_ledger_key_cost";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_usage_ledger_user_cost_cover";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_usage_ledger_provider_cost_cover";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_key_cost" ON "usage_ledger" USING btree ("key","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_user_cost_cover" ON "usage_ledger" USING btree ("user_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ledger_provider_cost_cover" ON "usage_ledger" USING btree ("final_provider_id","created_at","cost_usd","endpoint") WHERE "usage_ledger"."blocked_by" IS NULL;
