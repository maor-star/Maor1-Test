-- Fields on a mirrored task that belong to the cockpit, not to ClickUp.
--
-- The mirror overwrites a task's fields from ClickUp on every poll, which is
-- correct for what ClickUp owns and wrong for what it does not: the department
-- he filed it under, his tags, the money he attached to it. Those existed
-- nowhere in ClickUp, so a sync would silently clear them five minutes after
-- he set them.
--
-- Naming the pinned fields per task, rather than hard-coding a list in the
-- sync, means "he has taken this over" is a fact about the row and survives
-- anyone rewriting the sync.
alter table tasks add column if not exists pinned_fields text[] not null default '{}';

comment on column tasks.pinned_fields is
  'Fields on a mirrored task the cockpit owns; the ClickUp sync must not overwrite them.';
