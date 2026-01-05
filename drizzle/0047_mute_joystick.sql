ALTER TABLE "message_request" ADD COLUMN "thinking_signature_fix_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "thinking_signature_fix_reason" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "enable_thinking_signature_fix" boolean DEFAULT false NOT NULL;