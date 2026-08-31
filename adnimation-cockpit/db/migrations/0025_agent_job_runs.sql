-- Every run of an agent's job, and everything it printed.
--
-- A dry run whose output lives only in the browser tab that started it is a
-- dry run he cannot go back to, cannot compare against the next one, and
-- cannot look at the morning after. And a run started by a timer printed into
-- a journal on a box he does not have a shell on — which is the same as not
-- printing it at all.
--
-- Insert-only, like agent_runs (CLAUDE.md §6.6). Nothing here is ever updated.
create table if not exists agent_job_runs (
  id           bigserial primary key,
  agent_name   text not null,
  -- True when nothing was touched.
  dry          boolean not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  -- What it printed, exactly as it printed it.
  output       text not null default '',
  -- The counts it ended on, for the one-line summary.
  summary      jsonb not null default '{}'::jsonb
);

create index if not exists idx_agent_job_runs_agent
  on agent_job_runs (agent_name, started_at desc);
