-- 修复迁移：补齐 system_settings 缺失列（幂等）
--
-- 背景：
-- - 线上可能出现数据库结构漂移（例如使用旧数据卷/不完整备份恢复/手动建表等），导致 system_settings 缺少部分列
-- - 读取时会触发 42703（列不存在），进而降级读取；保存时 UPDATE ... RETURNING 引用缺列会直接失败
--
-- 策略：
-- - 使用 ADD COLUMN IF NOT EXISTS 逐列补齐，避免重复执行失败
-- - 默认值与约束保持与当前 schema.ts 预期一致

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "currency_display" varchar(10) DEFAULT 'USD' NOT NULL;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "billing_model_source" varchar(20) DEFAULT 'original' NOT NULL;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_auto_cleanup" boolean DEFAULT false;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "cleanup_retention_days" integer DEFAULT 30;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "cleanup_schedule" varchar(50) DEFAULT '0 2 * * *';

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "cleanup_batch_size" integer DEFAULT 10000;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_client_version_check" boolean DEFAULT false NOT NULL;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "verbose_provider_error" boolean DEFAULT false NOT NULL;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_http2" boolean DEFAULT false NOT NULL;

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "intercept_anthropic_warmup_requests" boolean DEFAULT false NOT NULL;
