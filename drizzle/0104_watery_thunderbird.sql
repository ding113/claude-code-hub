ALTER TABLE "message_request" ADD COLUMN IF NOT EXISTS "hedge_losers" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "bill_hedge_losers" boolean DEFAULT true NOT NULL;
