-- Session identity prefix indexes are installed by the concurrent index preflight.
-- This migration records the schema revision without running a blocking CREATE INDEX.
SELECT 1;
