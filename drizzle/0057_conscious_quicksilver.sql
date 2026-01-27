ALTER TABLE "message_request" ALTER COLUMN "input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "message_request" ALTER COLUMN "output_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "message_request" ALTER COLUMN "cache_creation_input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "message_request" ALTER COLUMN "cache_read_input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "message_request" ALTER COLUMN "cache_creation_5m_input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "message_request" ALTER COLUMN "cache_creation_1h_input_tokens" SET DATA TYPE bigint;