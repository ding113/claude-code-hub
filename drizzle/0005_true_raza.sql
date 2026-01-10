ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "original_model" varchar(128);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "messages_count" integer;
