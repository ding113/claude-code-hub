CREATE TABLE IF NOT EXISTS "provider_health_test_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"source" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"ok" boolean NOT NULL,
	"status" varchar(16),
	"model" varchar(128),
	"first_byte_ms" integer,
	"latency_ms" integer,
	"http_status_code" integer,
	"error_type" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "scheduled_health_test_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_ok" boolean;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_status" varchar(16);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_first_byte_ms" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_model" varchar(128);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_error_type" varchar(64);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "last_health_test_error_message" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_online_rate" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_avg_first_byte_ms" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "health_test_recent_results" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_health_test_logs" ADD CONSTRAINT "provider_health_test_logs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_health_test_logs_provider_created_at" ON "provider_health_test_logs" USING btree ("provider_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_health_test_logs_created_at" ON "provider_health_test_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_scheduled_health" ON "providers" USING btree ("scheduled_health_test_enabled","is_enabled","last_health_test_at") WHERE "providers"."deleted_at" IS NULL;
