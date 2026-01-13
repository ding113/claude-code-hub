CREATE TABLE IF NOT EXISTS "provider_endpoint_probe_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"source" varchar(20) DEFAULT 'active_probe' NOT NULL,
	"result" varchar(10) NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error_type" varchar(50),
	"error_message" text,
	"checked_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"provider_type" varchar(20) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_key" varchar(255) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"website_url" text,
	"favicon_url" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "vendor_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_probe_events_endpoint_time" ON "provider_endpoint_probe_events" USING btree ("endpoint_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_probe_events_checked_at" ON "provider_endpoint_probe_events" USING btree ("checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_vendor_type" ON "provider_endpoints" USING btree ("vendor_id","provider_type") WHERE "provider_endpoints"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_enabled_priority" ON "provider_endpoints" USING btree ("is_enabled","vendor_id","provider_type","priority","weight") WHERE "provider_endpoints"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_endpoints_vendor_type_base_url" ON "provider_endpoints" USING btree ("vendor_id","provider_type","base_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_created_at" ON "provider_endpoints" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_deleted_at" ON "provider_endpoints" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_vendors_vendor_key" ON "provider_vendors" USING btree ("vendor_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_vendors_created_at" ON "provider_vendors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_vendors_deleted_at" ON "provider_vendors" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_vendor" ON "providers" USING btree ("vendor_id") WHERE "providers"."deleted_at" IS NULL;