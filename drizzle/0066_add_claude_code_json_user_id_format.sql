ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_claude_code_json_user_id_format" boolean DEFAULT false NOT NULL;
