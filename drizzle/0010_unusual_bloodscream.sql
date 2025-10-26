ALTER TABLE "system_settings" ADD COLUMN "currency_display" varchar(10) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "enable_auto_cleanup" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "cleanup_retention_days" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "cleanup_schedule" varchar(50) DEFAULT '0 2 * * *';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "cleanup_batch_size" integer DEFAULT 10000;