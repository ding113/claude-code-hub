ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_budget_suspended_day" date;--> statement-breakpoint
COMMENT ON COLUMN "providers"."health_test_budget_suspended_day" IS 'Local day when scheduled health tests were auto-disabled for budget; next day auto re-enables';
