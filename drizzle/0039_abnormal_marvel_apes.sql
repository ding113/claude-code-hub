ALTER TABLE "keys" ALTER COLUMN "provider_group" SET DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider_group" SET DEFAULT 'default';--> statement-breakpoint
-- Migrate existing NULL values to 'default'
UPDATE "keys" SET "provider_group" = 'default' WHERE "provider_group" IS NULL;--> statement-breakpoint
UPDATE "users" SET "provider_group" = 'default' WHERE "provider_group" IS NULL;