-- The copilot: the conversation he has with the model over the company's data,
-- and the decisions the autopilot makes on its daily review.
--
-- Threads and messages are his record of what was asked and answered.
-- Decisions are the autopilot's: each one says what it saw, what it decided,
-- what it did about it (or proposed, at level 1), and whether he agreed. A
-- decision is never deleted — declined ones are the ones worth reading later.

create table if not exists copilot_threads (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'New conversation',
  provider     text not null default 'auto',
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create table if not exists copilot_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references copilot_threads(id) on delete cascade,
  role         text not null check (role in ('user', 'assistant', 'tool')),
  content      text not null default '',
  -- The tool calls the assistant made on the way to this answer, and what
  -- each returned, so the answer can be checked against what it actually read.
  tool_calls   jsonb not null default '[]'::jsonb,
  provider     text,
  model        text,
  input_tokens integer,
  output_tokens integer,
  created_at   timestamptz not null default now()
);

create index if not exists idx_copilot_messages_thread on copilot_messages (thread_id, created_at);

create table if not exists copilot_decisions (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid,
  -- lines | clients | deals | contracts | tasks | mail | agents | systems
  area          text not null,
  title         text not null,
  reasoning     text not null,
  -- The action it took or proposed: { kind, ...args }. kind is one of
  -- task | alert | note | stage | agent | none.
  action        jsonb not null default '{}'::jsonb,
  -- proposed (level 1, waiting on him) | executed | declined | approved
  status        text not null default 'proposed',
  executed_ref  text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    text
);

create index if not exists idx_copilot_decisions_status on copilot_decisions (status, created_at desc);
