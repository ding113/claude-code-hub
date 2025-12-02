CREATE TABLE IF NOT EXISTS "request_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"scope" varchar(20) NOT NULL,
	"action" varchar(30) NOT NULL,
	"match_type" varchar(20),
	"target" text NOT NULL,
	"replacement" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_filters_enabled" ON "request_filters" USING btree ("is_enabled","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_filters_scope" ON "request_filters" USING btree ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_filters_action" ON "request_filters" USING btree ("action");