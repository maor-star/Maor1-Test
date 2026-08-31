-- What he has taught an agent.
--
-- The definitions describe what an agent is for; this is where he tells it the
-- things only he knows — which senders to ignore, what counts as urgent here,
-- how he wants a draft to sound. Without it every correction has to come back
-- through me, which makes the agents mine rather than his.
alter table agents
  add column if not exists instructions text,
  add column if not exists instructions_updated_at timestamptz;

-- Invoices already forwarded, so a re-run never sends the same one twice.
-- This lived in the job, which tried to create it on every run; a table is a
-- migration's job, not a script's.
create table if not exists invoice_forwards (
  message_id   text primary key,
  thread_id    text,
  subject      text,
  from_email   text,
  forwarded_to text not null,
  forwarded_at timestamptz not null default now()
);
