ALTER TABLE "keys" ADD COLUMN "limit_concurrent_uas" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "limit_concurrent_uas" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limit_concurrent_uas" integer;--> statement-breakpoint
ALTER TABLE "keys"
  ADD CONSTRAINT "keys_limit_concurrent_uas_non_negative"
  CHECK ("limit_concurrent_uas" >= 0);--> statement-breakpoint
ALTER TABLE "providers"
  ADD CONSTRAINT "providers_limit_concurrent_uas_non_negative"
  CHECK ("limit_concurrent_uas" >= 0);--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_limit_concurrent_uas_non_negative"
  CHECK ("limit_concurrent_uas" IS NULL OR "limit_concurrent_uas" >= 0);
