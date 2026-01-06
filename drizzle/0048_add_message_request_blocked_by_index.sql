-- 性能优化：为 blocked_by 增加索引（排除软删除记录）
-- 说明：
-- - blocked_by 被多个统计/聚合查询频繁用于过滤 warmup/sensitive 等拦截请求
-- - 这里使用部分索引（WHERE deleted_at IS NULL），减少索引体积并匹配常见查询条件
CREATE INDEX IF NOT EXISTS "idx_message_request_blocked_by"
ON "message_request" ("blocked_by")
WHERE "deleted_at" IS NULL;

