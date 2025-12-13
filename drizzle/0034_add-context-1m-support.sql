ALTER TABLE "message_request" ADD COLUMN "context_1m_applied" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "context_1m_preference" varchar(20);