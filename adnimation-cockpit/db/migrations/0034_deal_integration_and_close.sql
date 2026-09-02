-- The two things the board could not say: how far into integration a deal is,
-- and whether it is finished.
--
-- integration_steps is a map of step key to { done, at, note, blockedOn }. The
-- steps themselves live in lib/pipeline/integration.ts and differ by side, so
-- adding one later costs nothing here.
--
-- closed_at takes a deal off the active board without deleting it (CLAUDE.md
-- §2). A board that is mostly finished work stops being read, and a won deal
-- with nowhere to go is how it becomes mostly finished work.

alter table pipeline_clients add column if not exists integration_steps jsonb not null default '{}'::jsonb;
alter table pipeline_clients add column if not exists closed_at     timestamptz;
alter table pipeline_clients add column if not exists close_outcome text;
alter table pipeline_clients add column if not exists close_note    text;

alter table pipeline_clients drop constraint if exists pipeline_close_outcome_ck;
alter table pipeline_clients add constraint pipeline_close_outcome_ck
  check (close_outcome is null or close_outcome in ('won', 'lost'));

create index if not exists idx_pipeline_open on pipeline_clients (stage)
  where archived_at is null and closed_at is null;
