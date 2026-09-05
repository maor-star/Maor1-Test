-- Every seat that traded, day by day.
--
-- The Trading, Demand and Supply screens have been reading a checked-in
-- fixture since they were built — they have never had a live figure. The
-- exchange reports each day split by SSP and by DSP, which answers both sides
-- from the same rows: a DSP is a demand seat (somebody buying through us), an
-- SSP is a supply seat (an endpoint we buy from).
--
-- One row per seat per day per side, so any window the screens ask for is a
-- sum over these rather than a second pull from the source.
--
-- Money in minor units as integers (CLAUDE.md §10).

create table if not exists seat_days (
  report_date  date not null,
  side         text not null,
  seat         text not null,
  seat_id      text,
  revenue_cents bigint not null default 0,
  cost_cents    bigint not null default 0,
  profit_cents  bigint not null default 0,
  impressions   bigint not null default 0,
  requests      bigint not null default 0,
  -- Counterparts traded with that day: endpoints for a demand seat, buyers
  -- for a supply seat.
  endpoints     integer not null default 0,
  source       text not null default 'adops',
  pulled_at    timestamptz not null default now(),
  primary key (report_date, side, seat)
);

create index if not exists idx_seat_days_side on seat_days (side, report_date);
create index if not exists idx_seat_days_date on seat_days (report_date);
