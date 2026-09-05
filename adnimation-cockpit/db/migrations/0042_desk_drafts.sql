-- The Copilot desk: the answer prepared for one thing waiting on him.
--
-- One row per desk item, keyed by the item's own id (`channel:key`), so a
-- redraft replaces rather than accumulates. The fingerprint is what the item
-- looked like when the draft was written: when the conversation moves, the
-- fingerprint changes and the draft is known to be stale rather than shown as
-- current.
--
-- Nothing here is ever sent by itself. A row is a suggestion until he presses
-- a button, and `acted_at` records that he did.

create table if not exists desk_drafts (
  item_id     text primary key,
  channel     text not null,
  fingerprint text not null,
  draft       jsonb not null,
  created_at  timestamptz not null default now(),
  acted_at    timestamptz,
  outcome     text
);

create index if not exists idx_desk_drafts_channel on desk_drafts (channel);
