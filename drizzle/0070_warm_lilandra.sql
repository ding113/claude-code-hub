-- 注意：message_request 为高写入表，标准 CREATE INDEX 可能在建索引期间阻塞写入。
-- Drizzle migrator 不支持 CREATE INDEX CONCURRENTLY；如对停写敏感，可在维护窗口升级，
-- 或在升级前手动用 CONCURRENTLY 预创建同名索引（本迁移已使用 IF NOT EXISTS，预建不会冲突）。
CREATE INDEX IF NOT EXISTS "idx_message_request_created_at_id_active" ON "message_request" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_tags_gin" ON "users" USING gin ("tags") WHERE "users"."deleted_at" IS NULL;
