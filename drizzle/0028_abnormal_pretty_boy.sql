ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_enabled_expires_at" ON "users" USING btree ("is_enabled","expires_at") WHERE "deleted_at" IS NULL;