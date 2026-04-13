-- Note: message_request is a high-write table. Standard CREATE INDEX may block writes during index creation.
-- Drizzle migrator does not support CREATE INDEX CONCURRENTLY. If write blocking is a concern,
-- manually pre-create this index with CONCURRENTLY before running this migration (IF NOT EXISTS prevents conflicts).
CREATE INDEX IF NOT EXISTS "idx_message_request_provider_created_at_finalized_active" ON "message_request" USING btree ("provider_id","created_at" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND "message_request"."status_code" IS NOT NULL;
