ALTER TABLE "keys"
ADD COLUMN IF NOT EXISTS "temporary_group_name" varchar(120);

CREATE INDEX IF NOT EXISTS "idx_keys_user_temporary_group"
ON "keys" ("user_id", "temporary_group_name")
WHERE "deleted_at" IS NULL AND "temporary_group_name" IS NOT NULL;
