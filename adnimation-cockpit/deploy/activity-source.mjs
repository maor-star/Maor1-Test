/**
 * How the control panel's lines are read out of the Ad Ops Architect source.
 *
 * Kept apart from the job that runs it so the expressions can be read in one
 * place and tested without a network. Where a line overlaps the P&L (bidder,
 * exchange, seat lease) the expression is the same one revenue-source.mjs
 * uses, so the panel and the revenue page cannot disagree about the same
 * money.
 *
 * Every statement here is a SELECT. The source is the live system the ad ops
 * team works in and the cockpit only ever reads it (CLAUDE.md).
 */
import { assertSelect } from './revenue-source.mjs';

export const LINES = [
  'core_clients', 'ibv', 'rtb_display', 'apps', 'ctv', 'google_ctv', 'seat_lease',
];

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The per-line daily queries. Each returns rows of
 *   { date, gross_cents, profit_cents, impressions, entities }
 * with `entities` the count of live things on the line that day, or null.
 */
export function lineQueries(from, to) {
  if (!isoDate(from) || !isoDate(to)) throw new Error(`dates must be YYYY-MM-DD, got ${from}..${to}`);
  const between = `report_date between '${from}' and '${to}'`;

  return {
    // The core publishers, as the source's own daily snapshot defines them.
    // It carries no per-day profit split we trust, so profit is what is left
    // after the source fee and the publisher's payout, which is the P&L's rule.
    core_clients: assertSelect(
      `select report_date::text as date,
         round(gross*100)::bigint                     as gross_cents,
         round((net_after_fee - net)*100)::bigint     as profit_cents,
         0::bigint                                    as impressions,
         null::int                                    as entities
       from ars_core_publishers_daily_snapshot
       where ${between} order by 1`,
    ),
    // In-banner and outstream video across the publisher portfolio.
    ibv: assertSelect(
      `select report_date::text as date,
         round(sum(gross_revenue)*100)::bigint                  as gross_cents,
         round(sum(coalesce(source_profit_usd,0))*100)::bigint  as profit_cents,
         sum(impressions)::bigint                               as impressions,
         count(distinct ars_site_id)::int                       as entities
       from ars_site_daily_rollup
       where category = 'video' and not src_ignored and ${between}
       group by 1 order by 1`,
    ),
    // Display bought through header bidding.
    rtb_display: assertSelect(
      `select report_date::text as date,
         round(sum(gross_revenue)*100)::bigint                  as gross_cents,
         round(sum(coalesce(source_profit_usd,0))*100)::bigint  as profit_cents,
         sum(impressions)::bigint                               as impressions,
         count(distinct ars_site_id)::int                       as entities
       from ars_site_daily_rollup
       where category = 'header_bidding' and not src_ignored and ${between}
       group by 1 order by 1`,
    ),
    apps: assertSelect(
      `select report_date::text as date,
         round(sum(revenue)*100)::bigint                        as gross_cents,
         0::bigint                                              as profit_cents,
         sum(impressions)::bigint                               as impressions,
         count(distinct coalesce(app_id, site_id::text))::int   as entities
       from gam_app_reports
       where ${between}
       group by 1 order by 1`,
    ),
    /*
     * CTV on the exchange. env_type is the environment the request came from,
     * so this is CTV wherever it was bought, not one endpoint's guess at it.
     */
    ctv: assertSelect(
      `select report_date::text as date,
         round(sum(revenue)*100)::bigint      as gross_cents,
         round(sum(profit)*100)::bigint       as profit_cents,
         sum(impressions)::bigint             as impressions,
         count(distinct dsp_id)::int          as entities
       from xe_econ_path_daily
       where env_type = 'CTV' and ${between}
       group by 1 order by 1`,
    ),
    /*
     * Google's CTV: Ad Manager's own device category. A set-top box is a
     * television as far as this line is concerned — the buyer treats them the
     * same and splitting them would give him two tiles nobody reads.
     */
    google_ctv: assertSelect(
      `select report_date::text as date,
         round(sum(revenue)*100)::bigint      as gross_cents,
         0::bigint                            as profit_cents,
         sum(impressions)::bigint             as impressions,
         count(distinct site_id)::int         as entities
       from gam_reports
       where device_category in ('connected tv', 'set-top box') and ${between}
       group by 1 order by 1`,
    ),
    seat_lease: assertSelect(
      `select report_date::text as date,
         round(sum(gross_revenue)*100)::bigint      as gross_cents,
         round(sum(adnimation_profit)*100)::bigint  as profit_cents,
         sum(impressions)::bigint                   as impressions,
         count(distinct partner_id)::int            as entities
       from get_seat_lease_overview_daily('${from}'::date, '${to}'::date)
       group by 1 order by 1`,
    ),
  };
}

/**
 * The accounts, one day at a time.
 *
 * The source's overview function returns per-site figures for a range, under
 * the source's own publisher rules — the same call the P&L makes. Asked for a
 * single day and joined up to the account, it gives one row per account per
 * day: gross, what is left for us, impressions.
 */
export function coreClientsQuery(day) {
  if (!isoDate(day)) throw new Error(`date must be YYYY-MM-DD, got ${day}`);
  return assertSelect(
    `select '${day}'::text                                 as date,
       a.name                                             as account,
       a.is_trading_account                               as is_trading,
       round(sum(s.gross)*100)::bigint                    as gross_cents,
       round(sum(s.net_after_fee - s.net)*100)::bigint    as profit_cents,
       sum(s.impressions)::bigint                         as impressions
     from get_ars_overview_summary('${day}'::date, '${day}'::date, null, null) s
     join ars_sites st on st.ars_site_id = s.ars_site_id
     join ars_accounts a on a.ars_id = st.ars_account_id
     group by 1, 2, 3
     having sum(s.gross) > 0
     order by 4 desc`,
  );
}

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Rows from the source, into the shape the table wants. */
export function toLineRows(line, rows, pulledAt = new Date()) {
  return (rows ?? [])
    .filter((r) => r?.date)
    .map((r) => ({
      line,
      date: String(r.date).slice(0, 10),
      gross_cents: num(r.gross_cents),
      profit_cents: num(r.profit_cents),
      impressions: num(r.impressions),
      entities: r.entities === null || r.entities === undefined ? null : num(r.entities),
      source: 'lovable',
      pulled_at: pulledAt,
    }));
}

export function toClientRows(rows, pulledAt = new Date()) {
  return (rows ?? [])
    .filter((r) => r?.date && r?.account)
    .map((r) => ({
      account: String(r.account).slice(0, 200),
      date: String(r.date).slice(0, 10),
      is_trading: Boolean(r.is_trading),
      gross_cents: num(r.gross_cents),
      profit_cents: num(r.profit_cents),
      impressions: num(r.impressions),
      source: 'lovable',
      pulled_at: pulledAt,
    }));
}

/**
 * A pull that would wipe real days is refused. A source outage answers with
 * nothing, and writing nothing over yesterday's figures is the one failure the
 * table cannot recover from on its own.
 */
export function assertWorthWriting(lineRows) {
  if (lineRows.length === 0) throw new Error('the source returned no days at all — refusing to touch the table');
  if (lineRows.every((r) => r.gross_cents === 0)) {
    throw new Error('the source returned only zeroes across the window — refusing to overwrite');
  }
  return lineRows;
}
