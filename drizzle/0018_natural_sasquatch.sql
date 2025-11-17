CREATE TABLE IF NOT EXISTS "error_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"match_type" varchar(20) DEFAULT 'regex' NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_rules_enabled" ON "error_rules" USING btree ("is_enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_pattern" ON "error_rules" USING btree ("pattern");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_category" ON "error_rules" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_type" ON "error_rules" USING btree ("match_type");
