ALTER TABLE "model_prices" ADD COLUMN "source" varchar(20) DEFAULT 'litellm' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_prices_source" ON "model_prices" USING btree ("source");
