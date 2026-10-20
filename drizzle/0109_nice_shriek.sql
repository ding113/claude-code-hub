CREATE TABLE IF NOT EXISTS "provider_batch_apply_operations" (
	"claim_key" varchar(256) PRIMARY KEY NOT NULL,
	"preview_token" varchar(256) NOT NULL,
	"payload_fingerprint" varchar(128) NOT NULL,
	"operation_id" varchar(256) NOT NULL,
	"undo_token" varchar(256) NOT NULL,
	"undo_expires_at" timestamp with time zone,
	"undo_consumed_at" timestamp with time zone,
	"status" varchar(32) NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_batch_apply_operations_preview_token" ON "provider_batch_apply_operations" USING btree ("preview_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_batch_apply_operations_operation_id" ON "provider_batch_apply_operations" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_batch_apply_operations_undo_token" ON "provider_batch_apply_operations" USING btree ("undo_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_batch_apply_operations_expires_at" ON "provider_batch_apply_operations" USING btree ("expires_at");
