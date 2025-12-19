-- Cursor-based pagination optimization index
-- This composite index enables efficient keyset pagination on message_request_logs
-- Query pattern: WHERE (created_at, id) < (cursor_created_at, cursor_id) ORDER BY created_at DESC, id DESC

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_request_logs_cursor"
ON "message_request_logs" ("created_at" DESC, "id" DESC);
