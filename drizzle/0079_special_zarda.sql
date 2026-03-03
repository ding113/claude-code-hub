-- Note: message_request is a high-write table. Standard CREATE INDEX may block writes during index creation.
-- Drizzle migrator does not support CREATE INDEX CONCURRENTLY. If write blocking is a concern,
-- manually pre-create indexes with CONCURRENTLY before running this migration (IF NOT EXISTS prevents conflicts).
CREATE INDEX IF NOT EXISTS "idx_message_request_active_created_at_id" ON "message_request" USING btree ("created_at","id") WHERE "message_request"."deleted_at" IS NULL AND "message_request"."duration_ms" IS NULL;
