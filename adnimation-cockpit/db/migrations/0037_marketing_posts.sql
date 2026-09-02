-- The posts the marketing agent writes, and what became of them.
--
-- A LinkedIn post is the one thing the cockpit produces that the outside world
-- reads, so the table is built around the gap between writing and publishing:
-- the agent fills `body`, he edits it, and only his click sets `posted_at`.
-- Nothing here is ever deleted — a declined draft is the clearest record there
-- is of what he does not want said in his name, and the next draft is written
-- with the declined ones in front of it.
--
-- `source_kind` + `source_ref` say what the post is about (a signed contract, a
-- deal gone live, a thread in his mail). One post per source: a re-run must not
-- write a second draft about the same win.

create table if not exists marketing_posts (
  id            uuid primary key default gen_random_uuid(),
  -- contract | deal | mail | manual
  source_kind   text not null,
  source_ref    text,
  -- What the win was, in one line, as the agent understood it.
  occasion      text not null,
  body          text not null,
  -- Anything the draft says that he should look at twice before it goes out —
  -- a figure, a client name, a word from the contract.
  flags         text[] not null default '{}',
  status        text not null default 'draft',
  edited_body   text,
  posted_url    text,
  posted_at     timestamptz,
  declined_at   timestamptz,
  decided_by    text,
  model         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists idx_marketing_source
  on marketing_posts (source_kind, source_ref)
  where source_ref is not null;

create index if not exists idx_marketing_open
  on marketing_posts (status, created_at desc);
