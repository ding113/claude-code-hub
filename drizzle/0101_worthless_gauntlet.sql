ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_openai_responses_websocket" boolean DEFAULT true NOT NULL;
