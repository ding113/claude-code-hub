ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "session_id" varchar(64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_session_id" ON "message_request" USING btree ("session_id") WHERE "message_request"."deleted_at" IS NULL;
