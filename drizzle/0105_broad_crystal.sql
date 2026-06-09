DO $$ BEGIN
	CREATE TYPE "public"."boost_window" AS ENUM('5h', 'daily', 'weekly', 'monthly', 'total');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."limit_subject" AS ENUM('user', 'key', 'user_group');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_group_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" "limit_subject" NOT NULL,
	"subject_id" integer NOT NULL,
	"model_group_id" integer NOT NULL,
	"rpm_limit" integer,
	"limit_5h_usd" numeric(10, 2),
	"limit_5h_reset_mode" "daily_reset_mode" DEFAULT 'fixed' NOT NULL,
	"daily_limit_usd" numeric(10, 2),
	"limit_weekly_usd" numeric(10, 2),
	"limit_monthly_usd" numeric(10, 2),
	"limit_total_usd" numeric(10, 2),
	"limit_5h_cost_reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_group_id" integer NOT NULL,
	"model" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"is_singleton" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_boost_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model_group_id" integer NOT NULL,
	"window" "boost_window" NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" varchar(255) NOT NULL,
	"name" varchar(128),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "counted_in_user_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "message_request" ADD COLUMN "counted_in_key_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_model_lease_percent_5h" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_model_lease_percent_daily" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_model_lease_percent_weekly" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_model_lease_percent_monthly" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "quota_model_lease_min_slice_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "counted_in_user_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "counted_in_key_global" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "model_group_limits" ADD CONSTRAINT "model_group_limits_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_group_members" ADD CONSTRAINT "model_group_members_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_boost_grants" ADD CONSTRAINT "quota_boost_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_boost_grants" ADD CONSTRAINT "quota_boost_grants_model_group_id_model_groups_id_fk" FOREIGN KEY ("model_group_id") REFERENCES "public"."model_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_group_limits_uniq_idx" ON "model_group_limits" USING btree ("subject_type","subject_id","model_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_limits_subject_idx" ON "model_group_limits" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_limits_group_idx" ON "model_group_limits" USING btree ("model_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_group_members_model_idx" ON "model_group_members" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_group_members_group_idx" ON "model_group_members" USING btree ("model_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_groups_name_idx" ON "model_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_boost_grants_target_idx" ON "quota_boost_grants" USING btree ("user_id","model_group_id","window");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_boost_grants_valid_to_idx" ON "quota_boost_grants" USING btree ("valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_groups_tag_idx" ON "user_groups" USING btree ("tag");