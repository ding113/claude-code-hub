ALTER TABLE "provider_health_test_logs" ADD COLUMN IF NOT EXISTS "input_tokens" bigint;--> statement-breakpoint
ALTER TABLE "provider_health_test_logs" ADD COLUMN IF NOT EXISTS "output_tokens" bigint;--> statement-breakpoint
ALTER TABLE "provider_health_test_logs" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" bigint;--> statement-breakpoint
ALTER TABLE "provider_health_test_logs" ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" bigint;--> statement-breakpoint
ALTER TABLE "provider_health_test_logs" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(21, 15);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_today_cost_usd" numeric(21, 15);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_today_calls" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_today_date" date;