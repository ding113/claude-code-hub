-- 每日成本限额功能 - 统一迁移文件 (修正 Enum 版)
-- 包含：创建枚举类型、添加字段、设置约束、添加重置模式

-- Step 0: 安全创建枚举类型 (如果不存在则创建)
DO $$ BEGIN
    CREATE TYPE "daily_reset_mode" AS ENUM('fixed', 'rolling');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Step 1: 添加基础字段
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint

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

--> statement-breakpoint
-- Step 3: 修正现有列类型 (防止之前已创建为 varchar)
-- 如果字段已经是 daily_reset_mode 类型，这步操作是安全的（无操作）
-- 如果字段是 varchar，这步会将其转换为枚举类型
ALTER TABLE "keys" 
  ALTER COLUMN "daily_reset_mode" TYPE "daily_reset_mode" 
  USING "daily_reset_mode"::"daily_reset_mode";
--> statement-breakpoint

ALTER TABLE "providers" 
  ALTER COLUMN "daily_reset_mode" TYPE "daily_reset_mode" 
  USING "daily_reset_mode"::"daily_reset_mode";
