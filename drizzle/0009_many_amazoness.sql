ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "allowed_models" jsonb DEFAULT 'null'::jsonb;
