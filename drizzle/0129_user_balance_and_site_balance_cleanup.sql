-- Move prepaid request credit to CCH users and remove the obsolete site-local ledger.
-- provider_sites.last_balance remains the read-only upstream balance snapshot.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "balance_usd" numeric(21, 15);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_balance_charges" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "request_id" integer NOT NULL,
  "provider_id" integer NOT NULL,
  "charge_key" varchar(128) NOT NULL,
  "amount_usd" numeric(21, 15) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_balance_charge_request_key"
  ON "user_balance_charges" USING btree ("request_id", "charge_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_balance_charge_user_created_at"
  ON "user_balance_charges" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_balance_charge_request"
  ON "user_balance_charges" USING btree ("request_id");
--> statement-breakpoint
DROP TABLE IF EXISTS "provider_site_balance_charges";
--> statement-breakpoint
ALTER TABLE "provider_sites" DROP COLUMN IF EXISTS "balance_usd";
