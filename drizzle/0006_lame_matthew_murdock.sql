CREATE TABLE IF NOT EXISTS "provider_schedule_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_time" timestamp with time zone NOT NULL,
	"executed_by" varchar(50) NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"total_providers" integer NOT NULL,
	"analyzed_providers" integer NOT NULL,
	"affected_providers" integer NOT NULL,
	"decisions" jsonb NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "base_weight" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "base_priority" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_schedule_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_auto_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "schedule_time" varchar(5) DEFAULT '02:00';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "min_sample_size" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "schedule_window_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_realtime_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "schedule_interval_seconds" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "exploration_rate" integer DEFAULT 15;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "circuit_recovery_weight_percent" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "circuit_recovery_observation_count" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "max_weight_adjustment_percent" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "short_term_window_minutes" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "medium_term_window_minutes" integer DEFAULT 360;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "long_term_window_minutes" integer DEFAULT 1440;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_logs_execution_time" ON "provider_schedule_logs" USING btree ("execution_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_logs_created_at" ON "provider_schedule_logs" USING btree ("created_at" DESC NULLS LAST);
