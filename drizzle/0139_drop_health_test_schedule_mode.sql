-- Drop health_test_schedule_mode: schedule policy is fixed to always-on.
-- SLO auto-disable rebalance (dynamic mode) removed; scheduler now always
-- reopens SLO-auto-disabled scheduled health tests.
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "health_test_schedule_mode";
