ALTER TABLE "system_settings" ALTER COLUMN "site_title" SET DEFAULT 'CC Hub';--> statement-breakpoint
UPDATE "system_settings" SET "site_title" = 'CC Hub' WHERE "site_title" = 'Claude Code Hub';
