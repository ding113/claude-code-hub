ALTER TABLE "keys" ADD COLUMN "cache_ttl_preference" varchar(10);--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_creation_5m_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_creation_1h_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "cache_ttl_applied" varchar(10);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "cache_ttl_preference" varchar(10);