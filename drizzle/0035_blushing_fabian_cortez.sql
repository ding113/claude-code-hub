ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_clients" jsonb DEFAULT '[]'::jsonb;
