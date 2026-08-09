-- Move the default scheduled health-test cadence to a wall-clock half-hour.
-- Preserve explicitly customized intervals; migrate only the previous default.
ALTER TABLE "system_settings"
  ALTER COLUMN "health_test_interval_seconds" SET DEFAULT 1800;
--> statement-breakpoint
UPDATE "system_settings"
SET "health_test_interval_seconds" = 1800
WHERE "health_test_interval_seconds" = 60;
