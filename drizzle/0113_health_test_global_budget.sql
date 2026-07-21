ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "health_test_daily_budget_cny" numeric(12, 4) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "health_test_global_budget_suspended_day" date;--> statement-breakpoint
COMMENT ON COLUMN "system_settings"."health_test_daily_budget_cny" IS 'Global daily health-test spend cap (display currency units, default 1); over budget disables ALL scheduled health tests until next local day';--> statement-breakpoint
COMMENT ON COLUMN "system_settings"."health_test_global_budget_suspended_day" IS 'Local day when ALL scheduled health tests were auto-disabled for global budget; next day auto re-enables';
