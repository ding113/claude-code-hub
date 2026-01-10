ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "preserve_client_ip" boolean NOT NULL DEFAULT false;
