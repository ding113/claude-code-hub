-- Dispatch whitelist / blacklist for provider groups (provider ids as jsonb arrays).
-- null/empty = disabled; non-empty = enforced. Whitelist applies first, then blacklist.
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "whitelist_provider_ids" jsonb;
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "blacklist_provider_ids" jsonb;