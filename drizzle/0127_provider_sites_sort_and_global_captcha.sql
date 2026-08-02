-- Provider site display order + global captcha credentials on system_settings.
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;

UPDATE "provider_sites" AS s
SET "sort_order" = sub.rn
FROM (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY name ASC, id ASC) - 1) AS rn
  FROM "provider_sites"
) AS sub
WHERE s.id = sub.id;

CREATE INDEX IF NOT EXISTS "idx_provider_sites_sort_order" ON "provider_sites" ("sort_order");

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "site_captcha_provider" varchar(32) DEFAULT 'none' NOT NULL;
ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "site_captcha_api_key_cipher" text;
ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "site_captcha_endpoint" text;
