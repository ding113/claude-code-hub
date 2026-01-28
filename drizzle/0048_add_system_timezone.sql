-- Add timezone column to system_settings table
-- Stores IANA timezone identifier (e.g., 'Asia/Shanghai', 'America/New_York')
-- NULL means: use TZ environment variable or fallback to UTC

ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "timezone" varchar(64);
