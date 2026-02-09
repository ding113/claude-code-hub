ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "group_priorities" jsonb DEFAULT 'null'::jsonb;
