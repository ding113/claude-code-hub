ALTER TABLE "providers" ADD COLUMN "active_time_start" varchar(5);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "active_time_end" varchar(5);--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "join_claude_pool";