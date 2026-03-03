-- Note: message_request is a high-write table. Standard CREATE INDEX may block writes during index creation.
-- Drizzle migrator does not support CREATE INDEX CONCURRENTLY. If write blocking is a concern,
-- manually pre-create indexes with CONCURRENTLY before running this migration (IF NOT EXISTS prevents conflicts).
CREATE INDEX IF NOT EXISTS "idx_message_request_user_created_at_id_completed" ON "message_request" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL AND "message_request"."duration_ms" IS NOT NULL AND ("message_request"."blocked_by" IS NULL OR "message_request"."blocked_by" <> 'warmup');
