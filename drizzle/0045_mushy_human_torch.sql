ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "limit_total_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "total_cost_reset_at" timestamp with time zone;
