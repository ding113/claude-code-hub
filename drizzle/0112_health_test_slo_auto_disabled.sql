ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_slo_auto_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "providers"."health_test_slo_auto_disabled" IS 'True when scheduled health tests were auto-disabled by SLO rebalance (primary+backup); rebalance may re-enable only these';
