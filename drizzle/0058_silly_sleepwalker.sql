ALTER TABLE "system_settings" ADD COLUMN "quota_db_refresh_interval_seconds" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_lease_percent_5h" numeric(5, 4) DEFAULT '0.05';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_lease_percent_daily" numeric(5, 4) DEFAULT '0.05';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_lease_percent_weekly" numeric(5, 4) DEFAULT '0.05';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_lease_percent_monthly" numeric(5, 4) DEFAULT '0.05';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_lease_cap_usd" numeric(10, 2);