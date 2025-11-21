-- 每日成本限额性能优化 - 部分索引
-- 为 keys 和 providers 表的每日限额字段添加部分索引，提升查询性能

-- 为 keys 表添加部分索引（仅索引配置了每日限额的记录）
CREATE INDEX IF NOT EXISTS "idx_keys_daily_limit" 
ON "keys"("limit_daily_usd", "daily_reset_mode") 
WHERE "limit_daily_usd" IS NOT NULL;--> statement-breakpoint

-- 为 providers 表添加部分索引（仅索引配置了每日限额的记录）
CREATE INDEX IF NOT EXISTS "idx_providers_daily_limit" 
ON "providers"("limit_daily_usd", "daily_reset_mode") 
WHERE "limit_daily_usd" IS NOT NULL;
