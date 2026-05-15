CREATE TABLE IF NOT EXISTS "public_status_hourly_rollups" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"config_version" varchar(128) NOT NULL,
	"source_group_name" varchar(200) NOT NULL,
	"public_group_slug" varchar(120) NOT NULL,
	"public_model_key" varchar(200) NOT NULL,
	"label" varchar(200) NOT NULL,
	"vendor_icon_key" varchar(100) NOT NULL,
	"request_type_badge" varchar(100) NOT NULL,
	"state" varchar(20) NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"availability_pct" double precision,
	"ttfb_ms" double precision,
	"tps" double precision,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_public_status_hourly_rollup" ON "public_status_hourly_rollups" USING btree ("bucket_start","public_group_slug","public_model_key","request_type_badge");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_public_status_hourly_rollups_bucket" ON "public_status_hourly_rollups" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_public_status_hourly_rollups_config_bucket" ON "public_status_hourly_rollups" USING btree ("config_version","bucket_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_public_status_hourly_rollups_group_model" ON "public_status_hourly_rollups" USING btree ("public_group_slug","public_model_key");
