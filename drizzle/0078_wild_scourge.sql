ALTER TABLE "keys" ADD COLUMN "limit_concurrent_uas" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "limit_concurrent_uas" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_concurrent_uas" integer;
