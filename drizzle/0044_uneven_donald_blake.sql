ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "intercept_anthropic_warmup_requests" boolean DEFAULT false NOT NULL;
