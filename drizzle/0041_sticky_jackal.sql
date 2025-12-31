ALTER TABLE "request_filters" ADD COLUMN "binding_type" varchar(20) DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_filters" ADD COLUMN "provider_ids" jsonb;--> statement-breakpoint
ALTER TABLE "request_filters" ADD COLUMN "group_tags" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_filters_binding" ON "request_filters" USING btree ("is_enabled","binding_type");