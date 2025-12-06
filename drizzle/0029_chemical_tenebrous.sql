DROP INDEX IF EXISTS "idx_users_enabled_expires_at";--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "can_login_web_ui" SET DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_enabled_expires_at" ON "users" USING btree ("is_enabled","expires_at") WHERE "users"."deleted_at" IS NULL;