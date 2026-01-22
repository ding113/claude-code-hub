ALTER TABLE "providers" ALTER COLUMN "provider_vendor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "group_priorities" jsonb DEFAULT 'null'::jsonb;