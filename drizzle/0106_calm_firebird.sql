ALTER TABLE "providers"
ADD COLUMN IF NOT EXISTS "codex_image_generation_preference" varchar(10);
