-- What to do next on a task, when it is due, and when it last moved.
--
-- A task already carries a due date, which is when the whole thing has to be
-- finished. That is not the same question as "what is the next move and when
-- does it happen" — the deals board has had both for months, and working a
-- task list without them means re-deciding the next move every time the row
-- comes round again.
--
-- last_touch_at is when it last moved rather than when it was last written:
-- the sync touches every mirrored row on every poll, so updated_at says
-- nothing about whether anything happened. It starts at created_at, which is
-- true — a task nobody has touched was last touched when it arrived.

alter table tasks add column if not exists next_step text;
alter table tasks add column if not exists next_step_date date;
alter table tasks add column if not exists last_touch_at timestamptz;

update tasks set last_touch_at = created_at where last_touch_at is null;

create index if not exists idx_tasks_next_step_date on tasks (next_step_date)
  where archived_at is null;
