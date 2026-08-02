ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "balance_auto_disabled" boolean DEFAULT false NOT NULL;