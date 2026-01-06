ALTER TABLE "providers" ADD COLUMN "codex_reasoning_effort_preference" varchar(20);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "codex_reasoning_summary_preference" varchar(20);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "codex_text_verbosity_preference" varchar(10);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "codex_parallel_tool_calls_preference" varchar(10);
