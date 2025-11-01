ALTER TABLE "providers" ADD COLUMN "proxy_url" varchar(512);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "proxy_fallback_to_direct" boolean DEFAULT false;