-- 添加超时配置字段（默认值：30s/10s/600s）
-- undici fetch 无法精确控制连接阶段超时
-- first_byte_timeout_streaming_ms 覆盖从请求开始到收到首字节的全过程（DNS + TCP + TLS + 请求发送 + 首字节接收）
ALTER TABLE "providers" ADD COLUMN "first_byte_timeout_streaming_ms" integer DEFAULT 30000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "streaming_idle_timeout_ms" integer DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "request_timeout_non_streaming_ms" integer DEFAULT 600000;--> statement-breakpoint
-- 先更新现有 NULL 值为默认值（防止 NOT NULL 约束失败）
UPDATE "providers" SET "first_byte_timeout_streaming_ms" = 30000 WHERE "first_byte_timeout_streaming_ms" IS NULL;--> statement-breakpoint
UPDATE "providers" SET "streaming_idle_timeout_ms" = 10000 WHERE "streaming_idle_timeout_ms" IS NULL;--> statement-breakpoint
UPDATE "providers" SET "request_timeout_non_streaming_ms" = 600000 WHERE "request_timeout_non_streaming_ms" IS NULL;--> statement-breakpoint
-- 添加 NOT NULL 约束
ALTER TABLE "providers" ALTER COLUMN "first_byte_timeout_streaming_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "streaming_idle_timeout_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "request_timeout_non_streaming_ms" SET NOT NULL;
