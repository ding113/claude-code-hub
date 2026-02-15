-- 注意：message_request 为高写入表，标准 CREATE INDEX 可能在建索引期间阻塞写入。
-- Drizzle migrator 不支持 CREATE INDEX CONCURRENTLY；如对停写敏感，可在维护窗口升级，
-- 或在升级前手动用 CONCURRENTLY 预创建同名索引（本迁移已使用 IF NOT EXISTS，预建不会冲突）。
CREATE INDEX IF NOT EXISTS "idx_message_request_key_created_at_id" ON "message_request" USING btree ("key","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_model_active" ON "message_request" USING btree ("model") WHERE "message_request"."deleted_at" IS NULL AND "message_request"."model" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_request_status_code_active" ON "message_request" USING btree ("status_code") WHERE "message_request"."deleted_at" IS NULL AND "message_request"."status_code" IS NOT NULL;
