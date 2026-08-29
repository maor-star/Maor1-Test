-- Contracts filed by rule rather than by a person stay flagged until reviewed.
-- Idempotent: safe to re-run against an already-migrated database.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS category_confirmed BOOLEAN NOT NULL DEFAULT false;
