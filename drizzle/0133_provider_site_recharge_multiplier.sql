-- CCH-facing recharge multiplier for upstream site ratios and balances.
-- Effective group ratio / real balance = upstream value / recharge_multiplier.
ALTER TABLE "provider_sites"
  ADD COLUMN IF NOT EXISTS "recharge_multiplier" numeric(12, 6) NOT NULL DEFAULT '1';
