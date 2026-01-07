CREATE INDEX IF NOT EXISTS "idx_message_request_blocked_by" ON "message_request" USING btree ("blocked_by") WHERE "message_request"."deleted_at" IS NULL;
