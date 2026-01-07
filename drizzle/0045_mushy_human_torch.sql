ALTER TABLE "providers" ADD COLUMN "limit_total_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "total_cost_reset_at" timestamp with time zone;
