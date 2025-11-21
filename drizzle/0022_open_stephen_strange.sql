UPDATE "keys"
SET "daily_reset_time" = '00:00'
WHERE "daily_reset_time" IS NULL OR trim("daily_reset_time") = '';--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_time" SET DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_time" SET NOT NULL;--> statement-breakpoint
UPDATE "providers"
SET "daily_reset_time" = '00:00'
WHERE "daily_reset_time" IS NULL OR trim("daily_reset_time") = '';--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_time" SET DEFAULT '00:00';--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_time" SET NOT NULL;
