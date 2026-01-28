ALTER TABLE "keys" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "timezone" varchar(64);