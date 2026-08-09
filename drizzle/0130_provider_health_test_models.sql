-- Add independent scheduled health-test model configuration and rolling stats.
ALTER TABLE "provider_groups"
  ADD COLUMN IF NOT EXISTS "health_test_models" jsonb;
--> statement-breakpoint
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "health_test_model_stats" jsonb DEFAULT 'null'::jsonb;
