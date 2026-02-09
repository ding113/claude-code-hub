DROP INDEX IF EXISTS "uniq_provider_endpoints_vendor_type_url";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_provider_endpoints_vendor_type_url" ON "provider_endpoints" USING btree ("vendor_id","provider_type","url") WHERE "provider_endpoints"."deleted_at" IS NULL;
