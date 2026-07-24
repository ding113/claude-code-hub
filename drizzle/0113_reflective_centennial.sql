ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "replay_enabled" boolean;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "cache_effectiveness_enabled" boolean;