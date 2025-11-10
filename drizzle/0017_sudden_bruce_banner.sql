ALTER TABLE "message_request" ADD COLUMN "endpoint" varchar(256);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_endpoint" ON "message_request" USING btree ("endpoint") WHERE "message_request"."deleted_at" IS NULL;
