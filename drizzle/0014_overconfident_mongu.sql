ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "proxy_url" varchar(512);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "proxy_fallback_to_direct" boolean DEFAULT false;
