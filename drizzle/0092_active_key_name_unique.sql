CREATE UNIQUE INDEX IF NOT EXISTS "uq_keys_user_name_active"
ON "keys" ("user_id", "name")
WHERE "deleted_at" IS NULL;
