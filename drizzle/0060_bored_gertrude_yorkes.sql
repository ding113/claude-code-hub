ALTER TABLE "notification_target_bindings" ALTER COLUMN "schedule_timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "anthropic_max_tokens_preference" varchar(20);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "anthropic_thinking_budget_preference" varchar(20);