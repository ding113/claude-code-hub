ALTER TABLE "request_filters" ADD COLUMN "rule_mode" varchar(20) DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_filters" ADD COLUMN "execution_phase" varchar(20) DEFAULT 'guard' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_filters" ADD COLUMN "operations" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_filters_phase" ON "request_filters" USING btree ("is_enabled","execution_phase");