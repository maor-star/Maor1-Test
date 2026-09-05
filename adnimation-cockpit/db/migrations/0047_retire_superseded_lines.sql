-- Retire the engine rows that were measuring something else.
--
-- EXCHANGE APP was reading Google Ad Manager's app inventory and EXCHANGE
-- DISPLAY was reading the publishers' header bidding. Neither is the exchange.
-- Both tiles are now read from the exchange itself, split by the environment
-- each demand endpoint sells into.
--
-- The days from 26 April onward have been re-derived under the new definition
-- and overwritten in place. The days before it cannot be: the exchange only
-- began reporting which buyer the money came from on 26 April 2026, and before
-- that it reported one company-level row a day with no demand endpoint on it.
-- So there is no environment split to be had for January to April, and the
-- rows still sitting there are the old measurement — $1.77m of Google's app
-- revenue on a tile that says EXCHANGE APP, and $622k of header bidding on one
-- that says EXCHANGE DISPLAY.
--
-- Leaving them is the worse of the two options: a tile that reports the wrong
-- business under a name that says otherwise is not a gap, it is a wrong answer,
-- and he cannot tell from the screen which it is.
--
-- Nothing is deleted (CLAUDE.md §2). The rows move to a retired table with the
-- reason attached, so the history is still there to look at and this is
-- reversible if the source ever backfills the demand endpoint on those days.

create table if not exists activity_daily_retired (
  line          text        not null,
  date          date        not null,
  gross_cents   bigint      not null default 0,
  profit_cents  bigint      not null default 0,
  impressions   bigint      not null default 0,
  entities      integer,
  source        text        not null,
  pulled_at     timestamptz not null,
  -- Why it is here, in words, so nobody has to reconstruct it from a date.
  retired_why   text        not null,
  retired_at    timestamptz not null default now(),
  primary key (line, date)
);

with moved as (
  delete from activity_daily
  where source = 'lovable'
    and line in ('apps', 'rtb_display', 'ctv')
  returning *
)
insert into activity_daily_retired
  (line, date, gross_cents, profit_cents, impressions, entities, source, pulled_at, retired_why)
select line, date, gross_cents, profit_cents, impressions, entities, source, pulled_at,
       case line
         when 'apps' then 'Measured Google Ad Manager app inventory, not the exchange''s app environment. No demand endpoint recorded before 2026-04-26, so it cannot be re-derived.'
         when 'rtb_display' then 'Measured the publishers'' header bidding, not the exchange''s web environment. No demand endpoint recorded before 2026-04-26, so it cannot be re-derived.'
         else 'Superseded by the exchange read; the day carried no revenue under either definition.'
       end
from moved
on conflict (line, date) do nothing;
