CREATE TABLE IF NOT EXISTS "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"circuit_breaker_enabled" boolean DEFAULT false NOT NULL,
	"circuit_breaker_webhook" varchar(512),
	"daily_leaderboard_enabled" boolean DEFAULT false NOT NULL,
	"daily_leaderboard_webhook" varchar(512),
	"daily_leaderboard_time" varchar(10) DEFAULT '09:00',
	"daily_leaderboard_top_n" integer DEFAULT 5,
	"cost_alert_enabled" boolean DEFAULT false NOT NULL,
	"cost_alert_webhook" varchar(512),
	"cost_alert_threshold" numeric(5, 2) DEFAULT '0.80',
	"cost_alert_check_interval" integer DEFAULT 60,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
