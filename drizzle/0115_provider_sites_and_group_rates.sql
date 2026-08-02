-- Site-based provider configuration + upstream group rates.
-- Inspired by Upstream Hub channels / rate_snapshots.

CREATE TABLE IF NOT EXISTS "provider_sites" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "site_url" text NOT NULL,
  "site_type" varchar(32) DEFAULT 'sub2api' NOT NULL,
  "provider_vendor_id" integer,
  "notes" text,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "upstream_hub_channel_id" integer,
  "last_rate_synced_at" timestamp with time zone,
  "last_cost_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_sites_name" ON "provider_sites" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_sites_vendor" ON "provider_sites" USING btree ("provider_vendor_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_sites"
    ADD CONSTRAINT "provider_sites_provider_vendor_id_provider_vendors_id_fk"
    FOREIGN KEY ("provider_vendor_id") REFERENCES "public"."provider_vendors"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "provider_site_group_rates" (
  "id" serial PRIMARY KEY NOT NULL,
  "site_id" integer NOT NULL,
  "group_name" varchar(256) NOT NULL,
  "description" text,
  "ratio" numeric(12, 6) DEFAULT '1' NOT NULL,
  "completion_ratio" numeric(12, 6) DEFAULT '0',
  "dispatch_group_tag" varchar(64),
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_site_group_rates_site_group"
  ON "provider_site_group_rates" USING btree ("site_id", "group_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_site_group_rates_site"
  ON "provider_site_group_rates" USING btree ("site_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_site_group_rates"
    ADD CONSTRAINT "provider_site_group_rates_site_id_provider_sites_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "public"."provider_sites"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "site_id" integer;
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "site_group_name" varchar(256);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "billing_mode" varchar(32) DEFAULT 'catalog_estimate' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_providers_site" ON "providers" USING btree ("site_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "providers"
    ADD CONSTRAINT "providers_site_id_provider_sites_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "public"."provider_sites"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
