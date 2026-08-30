-- Opportunities — the things he noticed and has not acted on.
--
-- Deliberately not the pipeline. A deal in the pipeline has an owner, a stage
-- and a next step; an opportunity is the stage before that, when it is still
-- just something worth doing that nobody has decided anything about. Those do
-- not fail loudly, they simply stop being mentioned — so the column that
-- matters most here is last_touched_at.
--
-- Nothing is ever deleted (CLAUDE.md §2): archived_at hides it instead.

create table if not exists opportunities (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  kind            text not null default 'other',
  status          text not null default 'new',
  note            text,
  counterparty    text,

  -- Rough size in minor units. Null means he has not put a number on it, which
  -- is different from zero and must stay distinguishable.
  value_cents     bigint,

  next_step       text,
  next_step_date  date,
  -- When a parked opportunity should come back to him.
  revisit_on      date,

  -- Where it came from, so a captured one keeps its trail back to the original
  -- conversation rather than becoming a note with no context.
  source          text not null default 'manual',
  source_url      text,
  source_excerpt  text,
  source_ref      text,
  source_at       timestamptz,

  -- Why the detector proposed it, shown on the suggestion so he can judge it
  -- without opening the mail.
  detect_reasons  text[] not null default '{}',
  detect_score    smallint,

  created_at      timestamptz not null default now(),
  created_by      text,
  -- Anything happening to it moves this. It is what "gone cold" is measured on.
  last_touched_at timestamptz not null default now(),
  decided_at      timestamptz,
  decided_note    text,
  archived_at     timestamptz,

  constraint opportunities_kind_ck check (kind in (
    'supply','demand','partnership','product','upsell','cost','hiring','investment','other')),
  constraint opportunities_status_ck check (status in (
    'suggested','new','exploring','parked','won','lost')),
  constraint opportunities_source_ck check (source in ('manual','mail','slack'))
);

create index if not exists idx_opportunities_live
  on opportunities (last_touched_at desc) where archived_at is null;

create index if not exists idx_opportunities_status
  on opportunities (status) where archived_at is null;

-- One suggestion per source conversation. Without this the mail detector would
-- propose the same thread again on every run, and the queue would fill with
-- duplicates of the item he already declined.
create unique index if not exists idx_opportunities_source_ref
  on opportunities (source, source_ref) where source_ref is not null;
