-- Who may see his tasks, and which of them are nobody's business but his.
--
-- The cockpit has had exactly two accounts since it was built. He asked to be
-- able to open the tasks board to other people, and to star the ones that stay
-- private.
--
-- Two things, deliberately separate:
--   · a star on a task — private, and private means him alone
--   · a grant to a person — they can reach the tasks board, and NOTHING else
--
-- The second half of that is the part that matters. A grant must not become a
-- key to the rest of the cockpit: the revenue, the P&L, the contracts, the
-- mail and the pipeline are not tasks, and somebody he let see a task list has
-- no business in any of them. The role this creates is enforced in the
-- middleware, not merely hidden in the navigation.

alter table tasks add column if not exists is_private boolean not null default false;

-- Starred tasks are read on every list, and there are few of them.
create index if not exists idx_tasks_private on tasks (is_private) where is_private;

create table if not exists task_access (
  id          uuid primary key default gen_random_uuid(),
  -- The address they sign in with. Held here rather than only as a person id
  -- because the sign-in gate has nothing but an email to go on.
  email       text        not null,
  person_id   uuid references people (id),
  -- 'view' reads the board; 'edit' may also change what is on it. Neither
  -- ever sees a starred task.
  level       text        not null default 'view',
  granted_by  text        not null,
  granted_at  timestamptz not null default now(),
  -- Revoked rather than deleted (CLAUDE.md §2): who had access to what, and
  -- when it was taken back, is exactly the history worth keeping.
  revoked_at  timestamptz,
  revoked_by  text,
  constraint task_access_level check (level in ('view', 'edit'))
);

-- One live grant per person. A second grant to the same address would leave
-- two rows disagreeing about their level, and the gate would pick whichever
-- the query returned first.
create unique index if not exists idx_task_access_live
  on task_access (lower(email)) where revoked_at is null;
