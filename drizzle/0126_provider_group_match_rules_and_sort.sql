-- Provider group keyword match rules + sort order for site-group classification.
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "provider_groups" ADD COLUMN IF NOT EXISTS "match_rules" jsonb;

-- Seed default sort: image -> grok -> claude -> codex (matches former hard-coded priority).
UPDATE "provider_groups" SET "sort_order" = 10 WHERE "name" = 'image' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 20 WHERE "name" = 'grok' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 30 WHERE "name" = 'claude' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 40 WHERE "name" = 'codex' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 100 WHERE "name" = 'Kimi' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 110 WHERE "name" = 'account pool' AND "sort_order" = 0;
UPDATE "provider_groups" SET "sort_order" = 0 WHERE "name" = 'default';

-- Seed keyword rules only when empty (preserve admin edits later).
UPDATE "provider_groups"
SET "match_rules" = '[
  {"matchType":"contains","pattern":"image"},
  {"matchType":"contains","pattern":"图"},
  {"matchType":"contains","pattern":"生图"}
]'::jsonb
WHERE "name" = 'image' AND ("match_rules" IS NULL OR "match_rules" = 'null'::jsonb OR "match_rules" = '[]'::jsonb);

UPDATE "provider_groups"
SET "match_rules" = '[
  {"matchType":"contains","pattern":"grok"}
]'::jsonb
WHERE "name" = 'grok' AND ("match_rules" IS NULL OR "match_rules" = 'null'::jsonb OR "match_rules" = '[]'::jsonb);

UPDATE "provider_groups"
SET "match_rules" = '[
  {"matchType":"contains","pattern":"claude"},
  {"matchType":"contains","pattern":"ccmax"},
  {"matchType":"contains","pattern":"kiro"},
  {"matchType":"contains","pattern":"aws"},
  {"matchType":"regex","pattern":"(^|[^a-zA-Z])cc([^a-zA-Z]|$)"}
]'::jsonb
WHERE "name" = 'claude' AND ("match_rules" IS NULL OR "match_rules" = 'null'::jsonb OR "match_rules" = '[]'::jsonb);

UPDATE "provider_groups"
SET "match_rules" = '[
  {"matchType":"contains","pattern":"gpt"},
  {"matchType":"contains","pattern":"openai"},
  {"matchType":"contains","pattern":"plus"},
  {"matchType":"contains","pattern":"pro"},
  {"matchType":"contains","pattern":"free"},
  {"matchType":"contains","pattern":"codex"},
  {"matchType":"contains","pattern":"team"},
  {"matchType":"contains","pattern":"免费"},
  {"matchType":"contains","pattern":"混合"},
  {"matchType":"contains","pattern":"日抛"},
  {"matchType":"contains","pattern":"奥特曼"},
  {"matchType":"contains","pattern":"福利"}
]'::jsonb
WHERE "name" = 'codex' AND ("match_rules" IS NULL OR "match_rules" = 'null'::jsonb OR "match_rules" = '[]'::jsonb);

CREATE INDEX IF NOT EXISTS "idx_provider_groups_sort_order" ON "provider_groups" ("sort_order", "id");
