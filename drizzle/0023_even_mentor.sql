ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;
