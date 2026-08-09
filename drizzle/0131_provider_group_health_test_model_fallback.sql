-- Add a group-level baseline health-test model for non-test request models and aggregate displays.
ALTER TABLE "provider_groups"
  ADD COLUMN IF NOT EXISTS "health_test_model_fallback" varchar(200);
