ALTER TABLE "providers" ADD COLUMN "circuit_breaker_failure_threshold" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "circuit_breaker_open_duration" integer DEFAULT 1800000;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "circuit_breaker_half_open_success_threshold" integer DEFAULT 2;