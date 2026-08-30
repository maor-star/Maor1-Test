-- The company P&L, one row per day, held in our own database.
--
-- It used to be a JSON fixture baked into the build, which meant the only way
-- to refresh the numbers was to redeploy the app. That is why the figures on
-- screen were days old: nothing was wrong with the arithmetic, there was simply
-- no mechanism for it to ever change. A table can be written by a timer.
--
-- Money in minor units (cents), per the engineering rules. Impressions are
-- counts. Every column is NOT NULL with a zero default: a business line that
-- reported nothing on a day genuinely earned nothing, and a NULL here would
-- silently drop that day out of a SUM.

create table if not exists company_daily (
  date                      date primary key,

  pub_gross_cents           bigint not null default 0,
  pub_source_fee_cents      bigint not null default 0,
  pub_net_after_fee_cents   bigint not null default 0,
  pub_payout_cents          bigint not null default 0,
  pub_profit_cents          bigint not null default 0,
  pub_impressions           bigint not null default 0,

  bidder_gross_cents        bigint not null default 0,
  bidder_profit_cents       bigint not null default 0,
  bidder_impressions        bigint not null default 0,

  seat_gross_cents          bigint not null default 0,
  seat_payout_cents         bigint not null default 0,
  seat_profit_cents         bigint not null default 0,
  seat_impressions          bigint not null default 0,

  xe_revenue_cents          bigint not null default 0,
  xe_cost_cents             bigint not null default 0,
  xe_profit_cents           bigint not null default 0,
  xe_impressions            bigint not null default 0,

  -- Where this row came from and when, so the screen can say how old it is
  -- rather than presenting a stale number as a current one.
  source                    text not null default 'lovable',
  pulled_at                 timestamptz not null default now()
);

create index if not exists company_daily_pulled_at_idx on company_daily (pulled_at desc);
