-- Add allowed_clients column to users table for client (CLI/IDE) restrictions
-- Empty array = no restrictions, non-empty = only listed patterns allowed
ALTER TABLE "users" ADD COLUMN "allowed_clients" jsonb DEFAULT '[]';
