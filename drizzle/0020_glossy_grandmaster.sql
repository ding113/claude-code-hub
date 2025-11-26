-- 幂等迁移: 合并 0020-0025 的所有变更
-- 此迁移可以在任何状态下安全执行（新安装、从 0019 升级、从冲突版本升级）

-- Step 0: 清理冲突的旧迁移记录（一次性，仅影响从冲突版本升级的用户）
DELETE FROM drizzle.__drizzle_migrations WHERE hash IN (
    '0020_next_juggernaut',
    '0021_daily_cost_limits',
    '0022_simple_stardust',
    '0023_cheerful_shocker',
    '0023_safe_christian_walker',
    '0024_update_provider_timeout_defaults',
    '0025_hard_violations'
);
--> statement-breakpoint

-- Step 1: 创建枚举类型（幂等）
DO $$ BEGIN
    CREATE TYPE "public"."daily_reset_mode" AS ENUM('fixed', 'rolling');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Step 2: 更新 providers 表默认值（幂等，无条件安全）
ALTER TABLE "providers" ALTER COLUMN "first_byte_timeout_streaming_ms" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "streaming_idle_timeout_ms" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "request_timeout_non_streaming_ms" SET DEFAULT 0;--> statement-breakpoint

-- Step 3: 添加 keys 表字段（幂等）
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00' NOT NULL;--> statement-breakpoint

-- Step 4: 添加 providers 表字段（幂等）
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "mcp_passthrough_type" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "mcp_passthrough_url" varchar(512);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "limit_daily_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(5) DEFAULT '00:00' NOT NULL;--> statement-breakpoint

-- Step 5: 添加 system_settings 表字段（幂等）
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "billing_model_source" varchar(20) DEFAULT 'original' NOT NULL;--> statement-breakpoint

-- Step 6: 添加 users 表字段（幂等）
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "limit_5h_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "limit_weekly_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "limit_monthly_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "limit_concurrent_sessions" integer;
