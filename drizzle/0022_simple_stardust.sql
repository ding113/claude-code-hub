CREATE TYPE "public"."daily_reset_mode" AS ENUM('fixed', 'rolling');--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_mode" SET DEFAULT 'fixed'::"public"."daily_reset_mode";--> statement-breakpoint
ALTER TABLE "keys" ALTER COLUMN "daily_reset_mode" SET DATA TYPE "public"."daily_reset_mode" USING "daily_reset_mode"::"public"."daily_reset_mode";--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_mode" SET DEFAULT 'fixed'::"public"."daily_reset_mode";--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "daily_reset_mode" SET DATA TYPE "public"."daily_reset_mode" USING "daily_reset_mode"::"public"."daily_reset_mode";