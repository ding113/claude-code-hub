ALTER TABLE "users" ADD COLUMN "limit_5h_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_weekly_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_monthly_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_concurrent_sessions" integer;