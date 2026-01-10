ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "currency_display" varchar(10) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_auto_cleanup" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "cleanup_retention_days" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "cleanup_schedule" varchar(50) DEFAULT '0 2 * * *';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "cleanup_batch_size" integer DEFAULT 10000;
