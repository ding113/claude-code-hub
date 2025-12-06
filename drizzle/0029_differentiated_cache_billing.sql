-- Differentiated cache billing: add 5-minute and 1-hour cache creation token tracking
-- See: https://github.com/ding113/claude-code-hub/issues/277
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "cache_creation_5m_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "cache_creation_1h_input_tokens" integer;
