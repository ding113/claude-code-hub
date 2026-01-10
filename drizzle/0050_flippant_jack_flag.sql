ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_response_fixer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "response_fixer_config" jsonb DEFAULT '{"fixTruncatedJson":true,"fixSseFormat":true,"fixEncoding":true,"maxJsonDepth":200,"maxFixSize":1048576}'::jsonb;
