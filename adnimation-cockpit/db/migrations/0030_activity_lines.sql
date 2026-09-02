-- The control panel's two tables.
--
-- One row per business line per day, and one row per paying account per day,
-- both pulled from the Ad Ops Architect source (read-only, CLAUDE.md) by the
-- activity sync. The screen reads these, never the source: a slow or absent
-- source degrades to yesterday's figures with their age on them, not to a
-- blank panel.

create table if not exists activity_daily (
  line          text        not null,
  date          date        not null,
  gross_cents   bigint      not null default 0,
  profit_cents  bigint      not null default 0,
  impressions   bigint      not null default 0,
  -- How many things were live that day: sites for video, apps for apps,
  -- feeds for trading, partners for seat lease. Null where the line has no
  -- natural unit.
  entities      integer,
  source        text        not null default 'lovable',
  pulled_at     timestamptz not null default now(),
  primary key (line, date)
);

create table if not exists core_clients_daily (
  account       text        not null,
  date          date        not null,
  is_trading    boolean     not null default false,
  gross_cents   bigint      not null default 0,
  -- What is left for us after the source fee and the publisher's share.
  profit_cents  bigint      not null default 0,
  impressions   bigint      not null default 0,
  source        text        not null default 'lovable',
  pulled_at     timestamptz not null default now(),
  primary key (account, date)
);

create index if not exists idx_core_clients_date on core_clients_daily (date);
