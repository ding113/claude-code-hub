DROP TABLE IF EXISTS "provider_schedule_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN IF EXISTS "base_weight";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN IF EXISTS "base_priority";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN IF EXISTS "last_schedule_time";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "enable_auto_schedule";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "schedule_time";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "min_sample_size";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "schedule_window_hours";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "enable_realtime_schedule";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "schedule_interval_seconds";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "exploration_rate";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "circuit_recovery_weight_percent";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "circuit_recovery_observation_count";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "max_weight_adjustment_percent";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "short_term_window_minutes";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "medium_term_window_minutes";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "long_term_window_minutes";
