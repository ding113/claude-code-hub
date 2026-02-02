ALTER TABLE "notification_target_bindings" ALTER COLUMN "schedule_timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "weekly_reset_day" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "weekly_reset_time" varchar(5);