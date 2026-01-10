ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "error_stack" text;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "error_cause" text;
