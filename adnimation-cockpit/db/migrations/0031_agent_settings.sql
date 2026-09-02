-- Two things an agent did not have: settings he can turn, and a way to be
-- retired without being deleted.
--
-- settings is the agent's own dials — thresholds, windows, scope, channel —
-- declared per agent in lib/agents/settings.ts and stored here as he set them.
-- What is not set falls back to the declared default, so an empty object is a
-- fully configured agent.
--
-- retired_at hides an agent the roster no longer carries. Nothing is deleted
-- (CLAUDE.md §2): its runs, its brief and its audit trail stay readable, and
-- the seeder knows not to bring it back.

alter table agents add column if not exists settings jsonb not null default '{}'::jsonb;
alter table agents add column if not exists retired_at timestamptz;
