ALTER TABLE "keys" ADD COLUMN "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "daily_reset_time" varchar(5) DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "daily_reset_time" varchar(5) DEFAULT '00:00';