ALTER TABLE "error_rules" ADD COLUMN "override_response" jsonb;--> statement-breakpoint
ALTER TABLE "error_rules" ADD COLUMN "override_status_code" integer;