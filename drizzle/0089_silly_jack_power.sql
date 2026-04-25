ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "temporary_group_name" varchar(120);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "cost_multiplier_correction" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keys_user_temporary_group" ON "keys" USING btree ("user_id","temporary_group_name") WHERE "keys"."deleted_at" IS NULL AND "keys"."temporary_group_name" IS NOT NULL;
