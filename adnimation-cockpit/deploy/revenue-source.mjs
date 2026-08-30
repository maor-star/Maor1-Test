/**
 * How the company P&L is read out of the Ad Ops Architect source.
 *
 * Kept apart from the job that runs it so the parts worth being sure about —
 * the read-only guard, the expressions themselves, and the merge that turns
 * four independent result sets into one row per day — can be tested rather than
 * only observed in production.
 *
 * Every expression here was validated against a settled day before it was
 * trusted: 2026-08-27 reproduced the previous snapshot exactly for the bidder,
 * seat lease and exchange, and to within 0.003% for publishers.
 */

/** The money and count columns, in the order company_daily declares them. */
export const NUMERIC = [
  'pub_gross_cents', 'pub_source_fee_cents', 'pub_net_after_fee_cents', 'pub_payout_cents',
  'pub_profit_cents', 'pub_impressions', 'bidder_gross_cents', 'bidder_profit_cents',
  'bidder_impressions', 'seat_gross_cents', 'seat_payout_cents', 'seat_profit_cents',
  'seat_impressions', 'xe_revenue_cents', 'xe_cost_cents', 'xe_profit_cents', 'xe_impressions',
];

const WRITE_KEYWORD = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/;

/**
 * The Ad Ops Architect system is read-only to us — it is the live system the ad
 * ops team works in. That rule is worth more than a comment, so it is a check
 * that every statement passes through before it can be sent.
 */
export function assertSelect(statement) {
  const stripped = String(statement).replace(/--[^\n]*/g, '').trim().toLowerCase();
  if (!(stripped.startsWith('select') || stripped.startsWith('with'))) {
    throw new Error('refusing to send a non-SELECT statement to the source');
  }
  if (WRITE_KEYWORD.test(stripped)) {
    throw new Error('refusing to send a statement containing a write keyword to the source');
  }
  return statement;
}

/**
 * The four expressions, one per business line.
 *
 * Publishers and seat lease call the source's own reporting functions, so they
 * inherit its rules — including the publisher methodology change on 2026-06-04.
 * The bidder's and the exchange's functions require an admin session we do not
 * have, so those two are the expressions copied verbatim out of the function
 * definitions, the bidder's 2026-06-01 switch included.
 */
export function buildQueries(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error(`dates must be YYYY-MM-DD, got ${from}..${to}`);
  }
  return {
    publishers: assertSelect(
      `with d as (select generate_series('${from}'::date, '${to}'::date, '1 day')::date as day)
       select d.day::text as date,
         round(sum(s.gross)*100)::bigint          as pub_gross_cents,
         round(sum(s.source_fee)*100)::bigint     as pub_source_fee_cents,
         round(sum(s.net_after_fee)*100)::bigint  as pub_net_after_fee_cents,
         round(sum(s.net)*100)::bigint            as pub_payout_cents,
         round((sum(s.net_after_fee)-sum(s.net))*100)::bigint as pub_profit_cents,
         sum(s.impressions)::bigint               as pub_impressions
       from d, lateral get_ars_overview_summary(d.day, d.day, null, null) s
       group by d.day order by d.day`,
    ),
    seats: assertSelect(
      `select report_date::text as date,
         round(sum(gross_revenue)*100)::bigint     as seat_gross_cents,
         round(sum(partner_payout)*100)::bigint    as seat_payout_cents,
         round(sum(adnimation_profit)*100)::bigint as seat_profit_cents,
         sum(impressions)::bigint                  as seat_impressions
       from get_seat_lease_overview_daily('${from}','${to}')
       group by report_date order by report_date`,
    ),
    bidder: assertSelect(
      `select report_date::text as date,
         round(sum(case when report_date >= date '2026-06-01'
                        then coalesce(ssp_revenue,0) else coalesce(revenue,0) end)*100)::bigint
           as bidder_gross_cents,
         round(sum(case when report_date >= date '2026-06-01'
                        then coalesce(revenue,0)-coalesce(third_party_net_revenue,0) else 0 end)*100)::bigint
           as bidder_profit_cents,
         sum(impressions)::bigint as bidder_impressions
       from trading_vidazoo_reports
       where report_date between '${from}' and '${to}'
       group by report_date order by report_date`,
    ),
    // ssp_id IS NULL is the un-split grain; without it every day is counted
    // once per SSP and the exchange appears several times its real size.
    exchange: assertSelect(
      `select report_date::text as date,
         round(sum(revenue)*100)::bigint    as xe_revenue_cents,
         round(sum(dsp_spend)*100)::bigint  as xe_cost_cents,
         round((sum(revenue)-sum(dsp_spend))*100)::bigint as xe_profit_cents,
         sum(impressions)::bigint           as xe_impressions
       from trading_xe_reports
       where ssp_id is null and report_date between '${from}' and '${to}'
       group by report_date order by report_date`,
    ),
  };
}

/**
 * Four result sets, each with its own set of dates, into one row per day.
 *
 * A line that reported nothing on a day earned nothing on that day, so every
 * gap is filled with a real zero rather than left undefined — a NULL here would
 * drop the whole day out of a SUM further up.
 */
export function mergeDays(sets, pulledAt = new Date()) {
  const byDate = new Map();
  for (const set of sets) {
    for (const row of set ?? []) {
      if (!row?.date) continue;
      const target = byDate.get(row.date) ?? { date: row.date };
      for (const [k, v] of Object.entries(row)) {
        if (k !== 'date' && NUMERIC.includes(k)) target[k] = Number(v ?? 0);
      }
      byDate.set(row.date, target);
    }
  }

  return [...byDate.values()]
    .map((r) => {
      const full = { date: r.date, source: 'lovable', pulled_at: pulledAt };
      for (const k of NUMERIC) full[k] = Number.isFinite(r[k]) ? r[k] : 0;
      return full;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Whether a pull is worth writing.
 *
 * A source outage that answers with no rows, or with zeroes for every line,
 * would otherwise wipe out real days. Refusing is always the safer failure:
 * the table keeps yesterday's correct figures and the screen says how old
 * they are.
 */
export function assertWorthWriting(rows) {
  if (rows.length === 0) {
    throw new Error('the source returned no days at all — refusing to touch the table');
  }
  const money = rows.reduce(
    (a, r) => a + r.pub_gross_cents + r.seat_gross_cents + r.bidder_gross_cents + r.xe_revenue_cents,
    0,
  );
  if (money === 0) {
    throw new Error('the source returned only zeroes across the window — refusing to overwrite');
  }
  return rows;
}
