ALTER TABLE "providers" ADD COLUMN "first_byte_timeout_streaming_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "streaming_idle_timeout_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "request_timeout_non_streaming_ms" integer DEFAULT 600000 NOT NULL;