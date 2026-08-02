ALTER TABLE "provider_sites" ADD COLUMN IF NOT EXISTS "balance_usd" numeric(21, 15);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_site_balance_charges" (
  "id" serial PRIMARY KEY NOT NULL,
  "site_id" integer NOT NULL,
  "provider_id" integer NOT NULL,
  "request_id" integer NOT NULL,
  "amount_usd" numeric(21, 15) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_site_balance_charge_request_provider"
  ON "provider_site_balance_charges" USING btree ("request_id", "provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_site_balance_charge_site_created_at"
  ON "provider_site_balance_charges" USING btree ("site_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_site_balance_charge_request"
  ON "provider_site_balance_charges" USING btree ("request_id");
