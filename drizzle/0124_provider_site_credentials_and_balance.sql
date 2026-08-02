-- Direct upstream site credentials + balance (no Upstream Hub required).
-- Each provider_site can login to sub2api/newapi itself, refresh group rates every 5m.

ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "username" varchar(256);
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "password_cipher" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "turnstile_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "captcha_provider" varchar(32) DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "captcha_api_key_cipher" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "captcha_endpoint" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "last_balance" numeric(18, 6);
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "last_balance_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "today_cost" numeric(18, 6);
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "total_cost" numeric(18, 6);
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "last_sync_error" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "session_access_token_cipher" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "session_cookie_cipher" text;
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "session_user_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "session_expires_at" timestamp with time zone;
