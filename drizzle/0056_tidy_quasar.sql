CREATE TABLE IF NOT EXISTS "provider_endpoint_probe_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"source" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error_type" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"provider_type" varchar(20) DEFAULT 'claude' NOT NULL,
	"url" text NOT NULL,
	"label" varchar(200),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_probed_at" timestamp with time zone,
	"last_probe_ok" boolean,
	"last_probe_status_code" integer,
	"last_probe_latency_ms" integer,
	"last_probe_error_type" varchar(64),
	"last_probe_error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"website_domain" varchar(255) NOT NULL,
	"display_name" varchar(200),
	"website_url" text,
	"favicon_url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "provider_vendor_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_endpoint_probe_logs" ADD CONSTRAINT "provider_endpoint_probe_logs_endpoint_id_provider_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."provider_endpoints"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_endpoints" ADD CONSTRAINT "provider_endpoints_vendor_id_provider_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."provider_vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoint_probe_logs_endpoint_created_at" ON "provider_endpoint_probe_logs" USING btree ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoint_probe_logs_created_at" ON "provider_endpoint_probe_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_endpoints_vendor_type_url" ON "provider_endpoints" USING btree ("vendor_id","provider_type","url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_vendor_type" ON "provider_endpoints" USING btree ("vendor_id","provider_type") WHERE "provider_endpoints"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_enabled" ON "provider_endpoints" USING btree ("is_enabled","vendor_id","provider_type") WHERE "provider_endpoints"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_created_at" ON "provider_endpoints" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_endpoints_deleted_at" ON "provider_endpoints" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_vendors_website_domain" ON "provider_vendors" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_vendors_created_at" ON "provider_vendors" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "providers" ADD CONSTRAINT "providers_provider_vendor_id_provider_vendors_id_fk" FOREIGN KEY ("provider_vendor_id") REFERENCES "public"."provider_vendors"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_vendor_type" ON "providers" USING btree ("provider_vendor_id","provider_type") WHERE "providers"."deleted_at" IS NULL;
