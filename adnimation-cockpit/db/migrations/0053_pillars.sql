-- The pillars become a list he owns, instead of seven names compiled into the app.
--
-- Until now the row of chips on Tasks, Pipeline and Contracts came from a
-- constant in lib/control/lines.ts: renaming one meant a code change and a
-- deploy, and adding one was not possible at all. He asked to add to and edit
-- that list, so the list moves into the database and the constant becomes what
-- it seeds.
--
-- `line` stays the key, not a new id. Every tag already written in entity_lines
-- and every target in line_targets is keyed by it, and the revenue source
-- reports against the same seven words — a surrogate id here would have meant
-- rewriting those and nothing would have been gained.
--
-- has_revenue marks the seven the activity sync actually delivers figures for.
-- A pillar he adds by hand can be tagged, filtered and counted on every board;
-- it has no tile on the overview, because there is no source behind it to read.
-- That flag is what the overview iterates, so the two never disagree.
CREATE TABLE IF NOT EXISTS pillars (
  line        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  unit        TEXT,
  source_note TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  -- Hiding, never deleting: a pillar switched off leaves the boards but its
  -- tags stay on the work that carries them, and switching it back on brings
  -- them all back.
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  has_revenue BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_pillars_order ON pillars(active, sort_order);

-- The seven, in the order they already sit in on the screen. ON CONFLICT DO
-- NOTHING so re-running this never overwrites a name he has since changed.
INSERT INTO pillars (line, label, unit, source_note, sort_order, has_revenue) VALUES
  ('core_clients', 'CORE PUBLISHERS', 'SITES',  'The represented publisher portfolio, every format, trading accounts excluded', 10, TRUE),
  ('ibv',          'IBV — VIDEO',     'SITES',  'Video units across the publisher portfolio — a cut of Core Publishers, not a separate book', 20, TRUE),
  ('rtb_display',  'EXCHANGE DISPLAY','BUYERS', 'The exchange, web environment', 30, TRUE),
  ('apps',         'EXCHANGE APP',    'BUYERS', 'The exchange, app environment', 40, TRUE),
  ('ctv',          'EXCHANGE CTV',    'BUYERS', 'The exchange, CTV environment', 50, TRUE),
  ('google_ctv',   'GOOGLE CTV',      'SITES',  'Google Ad Manager, connected TV and set-top box', 60, TRUE),
  ('bidder',       'BIDDER',          NULL,     'The Vidazoo bidder, from the P&L''s own daily rows', 70, TRUE)
ON CONFLICT (line) DO NOTHING;
