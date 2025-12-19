-- Cursor-based pagination optimization index
-- This composite index enables efficient keyset pagination on message_request
-- Query pattern: WHERE (created_at, id) < (cursor_created_at, cursor_id) ORDER BY created_at DESC, id DESC

CREATE INDEX IF NOT EXISTS "idx_message_request_cursor"
ON "message_request" ("created_at" DESC, "id" DESC);
