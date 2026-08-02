-- Request-model rules for providers in a provider group.
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "model_match_rules" jsonb;
