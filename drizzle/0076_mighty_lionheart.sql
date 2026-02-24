ALTER TYPE "public"."notification_type" ADD VALUE 'cache_hit_rate_alert';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_webhook" varchar(512);--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_window_mode" varchar(10) DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_check_interval" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_historical_lookback_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_min_eligible_requests" integer DEFAULT 20;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_min_eligible_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_abs_min" numeric(5, 4) DEFAULT '0.05';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_drop_rel" numeric(5, 4) DEFAULT '0.3';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_drop_abs" numeric(5, 4) DEFAULT '0.1';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_cooldown_minutes" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "cache_hit_rate_alert_top_n" integer DEFAULT 10;