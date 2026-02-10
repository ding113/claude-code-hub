ALTER TABLE "providers" ADD COLUMN "anthropic_adaptive_thinking" jsonb DEFAULT NULL;

-- Decouple adaptive thinking from thinking budget preference:
-- The adaptive config is now independently stored in anthropic_adaptive_thinking (JSONB),
-- so reset legacy 'adaptive' values in the varchar field to 'inherit' for data consistency.
UPDATE providers
SET anthropic_thinking_budget_preference = 'inherit'
WHERE anthropic_thinking_budget_preference = 'adaptive';