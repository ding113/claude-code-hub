ALTER TABLE "users" ADD COLUMN "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_reset_time" varchar(5) DEFAULT '00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allowed_models" jsonb DEFAULT '[]'::jsonb;