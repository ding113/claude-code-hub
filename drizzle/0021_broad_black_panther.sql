ALTER TABLE "error_rules" ADD COLUMN IF NOT EXISTS "override_response" jsonb;--> statement-breakpoint
ALTER TABLE "error_rules" ADD COLUMN IF NOT EXISTS "override_status_code" integer;
