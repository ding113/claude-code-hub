ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "verbose_provider_error" boolean DEFAULT false NOT NULL;
