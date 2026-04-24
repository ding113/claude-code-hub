ALTER TABLE "keys" ADD COLUMN "limit_5h_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "limit_5h_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_5h_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;