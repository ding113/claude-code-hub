ALTER TABLE "system_settings" ADD COLUMN "discovery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "discovery_concurrency" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "max_discovery_rounds" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "discovery_sla_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "sticky_sla_ms" integer DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "racing_total_timeout_ms" integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "sticky_timeout_cooldown_ms" integer DEFAULT 300000 NOT NULL;
