ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "codex_instructions_strategy" varchar(20) DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_client_version_check" boolean DEFAULT false NOT NULL;
