ALTER TABLE "providers" ADD COLUMN "allowed_clients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "blocked_clients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_clients" jsonb DEFAULT '[]'::jsonb NOT NULL;