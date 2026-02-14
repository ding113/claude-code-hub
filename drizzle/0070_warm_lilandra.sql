CREATE INDEX IF NOT EXISTS "idx_message_request_created_at_id_active" ON "message_request" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "message_request"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_tags_gin" ON "users" USING gin ("tags") WHERE "users"."deleted_at" IS NULL;
