ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "first_byte_timeout_streaming_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "streaming_idle_timeout_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "request_timeout_non_streaming_ms" integer DEFAULT 600000 NOT NULL;
