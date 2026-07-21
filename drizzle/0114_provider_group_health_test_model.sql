ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "health_test_model" varchar(200);--> statement-breakpoint
COMMENT ON COLUMN "provider_groups"."health_test_model" IS 'Default model for scheduled health tests in this group; empty/null = do not schedule tests for providers primarily in this group';
