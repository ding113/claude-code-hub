CREATE TABLE IF NOT EXISTS "keyword_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"keyword" varchar(500) NOT NULL,
	"source_model" varchar(128),
	"target_model" varchar(128) NOT NULL,
	"case_sensitive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_keyword_model_routing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keyword_routing_rules_enabled" ON "keyword_routing_rules" USING btree ("is_enabled","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_keyword_routing_rules_created_at" ON "keyword_routing_rules" USING btree ("created_at");