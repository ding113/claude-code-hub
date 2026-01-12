ALTER TABLE "keys" ALTER COLUMN "provider_group" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "provider_group" SET DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider_group" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider_group" SET DEFAULT 'default';