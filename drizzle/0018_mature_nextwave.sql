-- 添加超时配置字段（默认值：5s/10s/10s/600s）
ALTER TABLE "providers" ADD COLUMN "connect_timeout_ms" integer DEFAULT 5000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "first_byte_timeout_streaming_ms" integer DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "streaming_idle_timeout_ms" integer DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "request_timeout_non_streaming_ms" integer DEFAULT 600000;--> statement-breakpoint
-- 先更新现有 NULL 值为默认值（防止 NOT NULL 约束失败）
UPDATE "providers" SET "connect_timeout_ms" = 5000 WHERE "connect_timeout_ms" IS NULL;--> statement-breakpoint
UPDATE "providers" SET "first_byte_timeout_streaming_ms" = 10000 WHERE "first_byte_timeout_streaming_ms" IS NULL;--> statement-breakpoint
UPDATE "providers" SET "streaming_idle_timeout_ms" = 10000 WHERE "streaming_idle_timeout_ms" IS NULL;--> statement-breakpoint
UPDATE "providers" SET "request_timeout_non_streaming_ms" = 600000 WHERE "request_timeout_non_streaming_ms" IS NULL;--> statement-breakpoint
-- 添加 NOT NULL 约束
ALTER TABLE "providers" ALTER COLUMN "connect_timeout_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "first_byte_timeout_streaming_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "streaming_idle_timeout_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "request_timeout_non_streaming_ms" SET NOT NULL;