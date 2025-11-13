ALTER TABLE "providers" ADD COLUMN "group_tags" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "allow_cross_group_on_degrade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_groups" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_group_tags" ON "providers" USING gin ("group_tags") WHERE "providers"."deleted_at" IS NULL;