-- 添加供应商余额字段（预付费模式）
-- 用于跟踪预付费余额，null 表示无限制（后付费模式）
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "balance_usd" numeric(18, 4);