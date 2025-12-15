ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_models" jsonb DEFAULT '[]'::jsonb;
