ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "limit_total_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "limit_total_usd" numeric(10, 2);