ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "enable_anthropic_warmup_intercept" boolean NOT NULL DEFAULT false;

