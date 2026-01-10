ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "website_url" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "favicon_url" text;
