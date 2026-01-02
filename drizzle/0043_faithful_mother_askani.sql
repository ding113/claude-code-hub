DO $$ BEGIN
  CREATE TYPE "public"."notification_type" AS ENUM('circuit_breaker', 'daily_leaderboard', 'cost_alert');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."webhook_provider_type" AS ENUM('wechat', 'feishu', 'dingtalk', 'telegram', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_target_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"target_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"schedule_cron" varchar(100),
	"schedule_timezone" varchar(50) DEFAULT 'Asia/Shanghai',
	"template_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider_type" "webhook_provider_type" NOT NULL,
	"webhook_url" varchar(1024),
	"telegram_bot_token" varchar(256),
	"telegram_chat_id" varchar(64),
	"dingtalk_secret" varchar(256),
	"custom_template" jsonb,
	"custom_headers" jsonb,
	"proxy_url" varchar(512),
	"proxy_fallback_to_direct" boolean DEFAULT false,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_settings" ADD COLUMN "use_legacy_mode" boolean DEFAULT false NOT NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_target_bindings" ADD CONSTRAINT "notification_target_bindings_target_id_webhook_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."webhook_targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_notification_target_binding" ON "notification_target_bindings" USING btree ("notification_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_bindings_type" ON "notification_target_bindings" USING btree ("notification_type","is_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_bindings_target" ON "notification_target_bindings" USING btree ("target_id","is_enabled");