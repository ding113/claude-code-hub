ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_http2" boolean DEFAULT false NOT NULL;
