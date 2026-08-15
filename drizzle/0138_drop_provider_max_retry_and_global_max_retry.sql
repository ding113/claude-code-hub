ALTER TABLE "providers" DROP COLUMN IF EXISTS "max_retry_attempts";
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "max_retry_attempts" integer NOT NULL DEFAULT 1;
