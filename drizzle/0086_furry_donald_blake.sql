ALTER TABLE "keys" ADD COLUMN "five_hour_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "five_hour_reset_anchor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "five_hour_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "five_hour_reset_anchor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "five_hour_reset_mode" "daily_reset_mode" DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "five_hour_reset_anchor" timestamp with time zone;
