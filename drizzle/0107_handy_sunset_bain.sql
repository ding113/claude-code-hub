CREATE TABLE IF NOT EXISTS "cloud_pricing_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(64) NOT NULL,
	"currency" varchar(16) DEFAULT 'USD' NOT NULL,
	"refreshed_at" timestamp with time zone,
	"providers" jsonb NOT NULL,
	"vendors" jsonb NOT NULL,
	"model_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "model_prices" ALTER COLUMN "source" SET DEFAULT 'cloud';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_vendor" ON "model_prices" USING btree ((("price_data" ->> 'vendor')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_aliases" ON "model_prices" USING gin ((("price_data" -> 'aliases')));