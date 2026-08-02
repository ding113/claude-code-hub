-- Provider group shared defaults (routing/network/circuit) applied to members.
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "shared_settings" jsonb;
