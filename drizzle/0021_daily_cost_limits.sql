-- 每日成本限额功能 - 统一迁移文件
-- 包含：添加字段、设置约束、添加重置模式

-- Step 1: 添加基础字段 (添加了 IF NOT EXISTS 以防止重复创建报错)
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_mode" varchar(10) DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_mode" varchar(10) DEFAULT 'fixed' NOT NULL;--> statement-breakpoint

-- Step 2: 数据清理和约束设置
UPDATE "keys"
SET "daily_reset_time" = '00:00'
WHERE "daily_reset_time" IS NULL OR trim("daily_reset_time") = '';--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_time" SET DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_time" SET NOT NULL;--> statement-breakpoint
UPDATE "providers"
SET "daily_reset_time" = '00:00'
WHERE "daily_reset_time" IS NULL OR trim("daily_reset_time") = '';--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_time" SET DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_time" SET NOT NULL;
