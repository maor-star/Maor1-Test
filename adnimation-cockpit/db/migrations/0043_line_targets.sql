-- What each of the company's pillars is meant to earn, per month.
--
-- One row per line per month, so a target that changes in March does not
-- rewrite what February was judged against. `source` says where the number
-- came from: 'manual' is one he typed on the overview, 'feed' is one pulled
-- from the planning system — a figure he set must never be silently
-- overwritten by a feed, and a fed figure must never be mistaken for his.
--
-- Money in minor units as integers, like everywhere else (CLAUDE.md §10).

create table if not exists line_targets (
  line         text not null,
  month        date not null,
  target_cents bigint not null,
  basis        text not null default 'gross',
  source       text not null default 'manual',
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (line, month)
);

create index if not exists idx_line_targets_month on line_targets (month);
