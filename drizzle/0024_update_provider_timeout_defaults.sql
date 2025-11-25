-- 修改供应商超时配置默认值为 0（不限制）
-- 并批量更新流式静默期超时：小于 60s 的改为 60s

-- 1. 修改默认值为 0（不限制超时）
ALTER TABLE "providers" ALTER COLUMN "first_byte_timeout_streaming_ms" SET DEFAULT 0;
ALTER TABLE "providers" ALTER COLUMN "streaming_idle_timeout_ms" SET DEFAULT 0;
ALTER TABLE "providers" ALTER COLUMN "request_timeout_non_streaming_ms" SET DEFAULT 0;

-- 2. 批量更新流式静默期超时
-- 规则：
--   - 小于 60000ms (60s) 且大于 0 的 → 改为 60000
--   - 等于 0（不限制）的 → 不操作
--   - 大于等于 60000 的 → 不操作
UPDATE "providers"
SET "streaming_idle_timeout_ms" = 60000
WHERE "streaming_idle_timeout_ms" > 0 
  AND "streaming_idle_timeout_ms" < 60000
  AND "deleted_at" IS NULL;
