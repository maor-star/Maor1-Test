/**
 * The arithmetic the source used to do, moved here.
 *
 * The old syncs sent SQL and let Postgres group and sum. Reading over REST
 * means the rows arrive whole and the grouping happens in Node — so every
 * expression that used to live in a query string lives here instead, apart
 * from the network, where it can be tested against a handful of rows rather
 * than against a live ad server.
 *
 * The rules are the same rules, deliberately: where a line overlaps the P&L
 * the expression matches the one the P&L uses, so the panel and the revenue
 * page cannot disagree about the same money.
 *
 * Money is rounded to minor units as integers at the last possible moment,
 * once per day per line, exactly where the SQL's `round(x*100)` did it.
 */

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Dollars to cents, rounded once, at the end. */
export const cents = (v) => Math.round(num(v) * 100);

/** Group rows by a key, into a Map of arrays. */
export function groupBy(rows, key) {
  const out = new Map();
  for (const row of rows ?? []) {
    const k = typeof key === 'function' ? key(row) : row[key];
    if (k === null || k === undefined) continue;
    const list = out.get(String(k)) ?? [];
    list.push(row);
    out.set(String(k), list);
  }
  return out;
}

const sumOf = (rows, field) => rows.reduce((a, r) => a + num(r[field]), 0);
const distinct = (rows, field) =>
  new Set(rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined)).size;

/** Every date in a range, inclusive, as YYYY-MM-DD. */
export function eachDay(from, to) {
  const days = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** A date column that may be a timestamp, as a plain day. */
const dayOf = (row, field = 'report_date') => String(row[field] ?? '').slice(0, 10);

/* ------------------------------------------------------------------ *
 * The P&L — the four books, one row per day.
 * ------------------------------------------------------------------ */

/**
 * Publishers, from the source's own overview report.
 *
 * The report is per site for a range, so it is asked one day at a time and the
 * sites are summed — which is what the old query's lateral join per day did.
 * Profit is what is left after the source fee and the publisher's payout,
 * which is the P&L's rule and not ours.
 */
export function publishersDay(date, siteRows) {
  const netAfterFee = sumOf(siteRows, 'net_after_fee');
  const net = sumOf(siteRows, 'net');
  return {
    date,
    pub_gross_cents: cents(sumOf(siteRows, 'gross')),
    pub_source_fee_cents: cents(sumOf(siteRows, 'source_fee')),
    pub_net_after_fee_cents: cents(netAfterFee),
    pub_payout_cents: cents(net),
    pub_profit_cents: cents(netAfterFee - net),
    pub_impressions: Math.round(sumOf(siteRows, 'impressions')),
  };
}

/** Seat lease, from the source's own daily overview, summed per day. */
export function seatDays(rows) {
  return [...groupBy(rows, (r) => dayOf(r)).entries()]
    .map(([date, day]) => ({
      date,
      seat_gross_cents: cents(sumOf(day, 'gross_revenue')),
      seat_payout_cents: cents(sumOf(day, 'partner_payout')),
      seat_profit_cents: cents(sumOf(day, 'adnimation_profit')),
      seat_impressions: Math.round(sumOf(day, 'impressions')),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The Vidazoo bidder — Budder.
 *
 * The source changed how it reports this on 2026-06-01: before that date the
 * gross is `revenue` and no profit is split out; from it, gross is the SSP's
 * revenue and profit is what is left after the third party. Carrying the
 * switch here rather than smoothing it over is the only way the figures agree
 * with the source's own screens on both sides of that date.
 */
const BIDDER_SWITCH = '2026-06-01';

export function bidderDays(rows) {
  return [...groupBy(rows, (r) => dayOf(r)).entries()]
    .map(([date, day]) => {
      const after = date >= BIDDER_SWITCH;
      const gross = day.reduce(
        (a, r) => a + (after ? num(r.ssp_revenue) : num(r.revenue)),
        0,
      );
      const profit = after
        ? day.reduce((a, r) => a + (num(r.revenue) - num(r.third_party_net_revenue)), 0)
        : 0;
      return {
        date,
        bidder_gross_cents: cents(gross),
        bidder_profit_cents: cents(profit),
        bidder_impressions: Math.round(sumOf(day, 'impressions')),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The exchange.
 *
 * Only the rows with no ssp_id: that is the un-split grain. Counting the split
 * rows as well counts every day once per SSP, and the exchange appears several
 * times its real size.
 */
export function exchangeDays(rows) {
  const unsplit = (rows ?? []).filter((r) => r.ssp_id === null || r.ssp_id === undefined);
  return [...groupBy(unsplit, (r) => dayOf(r)).entries()]
    .map(([date, day]) => {
      const revenue = sumOf(day, 'revenue');
      const spend = sumOf(day, 'dsp_spend');
      return {
        date,
        xe_revenue_cents: cents(revenue),
        xe_cost_cents: cents(spend),
        xe_profit_cents: cents(revenue - spend),
        xe_impressions: Math.round(sumOf(day, 'impressions')),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ *
 * The seven pillars.
 * ------------------------------------------------------------------ */

const lineDay = (date, { gross, profit, impressions, entities }) => ({
  date,
  gross_cents: cents(gross),
  profit_cents: cents(profit),
  impressions: Math.round(num(impressions)),
  entities: entities === null || entities === undefined ? null : Math.round(entities),
});

/**
 * The year the cockpit reports on.
 *
 * He asked for this year and no further back: "take only this year's data, no
 * more". Every window the syncs build is clamped to it, so a stray argument or
 * a default of four hundred days cannot walk the source's whole history again.
 */
export const YEAR_START = '2026-01-01';

/** A window, never reaching further back than the year he asked for. */
export const clampToYear = (from) => (from < YEAR_START ? YEAR_START : from);

/* ------------------------------------------------------------------ *
 * The publisher business, from the site detail.
 *
 * These three lines used to read `ars_site_daily_rollup` and
 * `ars_core_publishers_daily_snapshot`. Both are aggregates the source builds
 * for its own screens, and both were revoked from this sign-in in the middle
 * of an afternoon — after which IBV, Exchange Display and Core Publishers all
 * showed a flat zero, which reads as a business that stopped rather than as a
 * grant that changed.
 *
 * `ars_site_daily_revenue` is the detail underneath both of them and this
 * sign-in can read it. Summed the same way it reproduces the rollup to the
 * dollar — checked against the source: for 29–31 August, google 58,297 against
 * 58,297, video 28,364 against 28,364. So the figures do not move; only the
 * table they are read from does, and this one does not depend on a grant that
 * can be taken away.
 * ------------------------------------------------------------------ */

/**
 * A source the ad ops team has told the system to ignore.
 *
 * The rollup carried this as `src_ignored`; on the detail it lives one table
 * over, on the demand source itself. Dropping the join would quietly add back
 * the analytics and expense rows the source has already decided are not
 * revenue.
 */
export function ignoredSourceNames(demandSources) {
  return new Set(
    (demandSources ?? [])
      .filter((s) => s.is_ignored)
      .map((s) => String(s.source_name ?? '').toLowerCase()),
  );
}

const notIgnored = (ignored) => (row) =>
  !ignored.has(String(row.source_name ?? '').toLowerCase());

/**
 * One format across the whole publisher portfolio — video, for IBV.
 *
 * A format cut, not a set of accounts: it runs across every publisher, which
 * is why it overlaps Core Publishers on purpose and why the two tiles do not
 * add up to anything.
 */
export function categoryLine(detailRows, category, ignored = new Set()) {
  const kept = (detailRows ?? []).filter((r) => r.category === category).filter(notIgnored(ignored));
  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) =>
      lineDay(date, {
        gross: sumOf(day, 'gross_revenue'),
        profit: sumOf(day, 'source_profit_usd'),
        impressions: sumOf(day, 'impressions'),
        entities: distinct(day, 'ars_site_id'),
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A trading account: one we buy and resell through rather than represent.
 *
 * They are publishers' money in the same table, but they are a different
 * business with a different margin, and the ad ops team marks them. Core
 * Publishers is the represented portfolio, so they are left out of it — and
 * kept, marked, in the account ranking, where the mark is what stops a reader
 * comparing their margin to a publisher's.
 */
const isTrading = (account) => Boolean(account?.is_trading_account ?? account?.is_trading ?? false);

/**
 * Core publishers: the represented portfolio, every format together.
 *
 * The source's own snapshot would have been the obvious thing to read, and it
 * is what this used to read. Two reasons it is not read any more: this sign-in
 * is denied it, and its net_after_fee and net are the same number every day —
 * so the profit it yields is a hard zero, which is not a figure to put on the
 * CEO's largest tile.
 */
export function coreClientsLine(detailRows, accountsById = new Map(), ignored = new Set()) {
  const kept = (detailRows ?? [])
    .filter(notIgnored(ignored))
    .filter((r) => !isTrading(accountsById.get(String(r.ars_account_id))));

  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) =>
      lineDay(date, {
        gross: sumOf(day, 'gross_revenue'),
        profit: sumOf(day, 'source_profit_usd'),
        impressions: sumOf(day, 'impressions'),
        entities: distinct(day, 'ars_site_id'),
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ *
 * The exchange, split by environment.
 * ------------------------------------------------------------------ */

/**
 * Which tile each environment belongs to.
 *
 * He settled this himself: the three tiles whose names start with EXCHANGE are
 * one business seen in three environments, not three different businesses. So
 * an app impression on the exchange is EXCHANGE APP wherever it was bought,
 * and Google's own app inventory — which used to fill this tile — is not on it
 * at all, because Google is not the exchange.
 *
 * Two vocabularies for the same thing: the path report says APP/SITE/CTV, the
 * endpoint dimension says INAPP/WEB/CTV.
 */
export const EXCHANGE_ENV_LINE = {
  APP: 'apps',
  INAPP: 'apps',
  SITE: 'rtb_display',
  WEB: 'rtb_display',
  CTV: 'ctv',
};

/** The environment of each demand endpoint, by its id. */
export function endpointEnvironments(endpointRows) {
  const out = new Map();
  for (const row of endpointRows ?? []) {
    if (String(row.endpoint_kind ?? '') !== 'dsp') continue;
    if (!row.environment) continue;
    out.set(String(row.endpoint_id), String(row.environment).toUpperCase());
  }
  return out;
}

/**
 * One environment of the exchange, from the demand endpoints' own reports.
 *
 * The rows are the per-DSP totals — the ones with a dsp_id and no ssp_id. The
 * pair rows in the same table say the same money once per endpoint it passed
 * through, and summing both reports the exchange at twice its size.
 *
 * Profit is revenue less what the DSP was charged, which is the rule the P&L
 * already uses for the exchange.
 *
 * Where this differs from the source's own path report: the path report knows
 * the environment of each path, this knows the environment of each demand
 * endpoint. The totals agree (28,280 against 28,279 for the last week of
 * August); the app/display line between them moves by about $680 in the week,
 * which matters little on APP and is most of DISPLAY. It is read this way
 * because the path report is denied to this sign-in, and because it is half a
 * million rows a month against forty-five thousand in the whole of this one.
 */
export function exchangeEnvLine(reportRows, envByDsp, line) {
  const kept = (reportRows ?? []).filter(
    (r) =>
      r.dsp_id !== null && r.dsp_id !== undefined &&
      (r.ssp_id === null || r.ssp_id === undefined) &&
      EXCHANGE_ENV_LINE[envByDsp.get(String(r.dsp_id))] === line,
  );

  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) => {
      const revenue = sumOf(day, 'revenue');
      return lineDay(date, {
        gross: revenue,
        profit: revenue - sumOf(day, 'dsp_spend'),
        impressions: sumOf(day, 'impressions'),
        entities: distinct(day, 'dsp_id'),
      });
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Google's CTV: Ad Manager's own device category. A set-top box counts as a
 * television here — the buyer treats them the same, and splitting them would
 * give him two tiles nobody reads.
 */
const GOOGLE_CTV_DEVICES = new Set(['connected tv', 'set-top box']);

export function googleCtvLine(rows) {
  const kept = (rows ?? []).filter((r) =>
    GOOGLE_CTV_DEVICES.has(String(r.device_category ?? '').toLowerCase()),
  );
  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) =>
      lineDay(date, {
        gross: sumOf(day, 'revenue'),
        profit: 0,
        impressions: sumOf(day, 'impressions'),
        entities: distinct(day, 'site_id'),
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Budder as a pillar: the same bidder days, in the pillars' shape. */
export function bidderLine(rows) {
  return bidderDays(rows).map((d) =>
    lineDay(d.date, {
      gross: d.bidder_gross_cents / 100,
      profit: d.bidder_profit_cents / 100,
      impressions: d.bidder_impressions,
      entities: null,
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The seats — demand and supply.
 * ------------------------------------------------------------------ */

/**
 * Every seat that traded in the window, one row per seat per day.
 *
 * The exchange reports each day split by SSP and DSP. A DSP is a demand seat —
 * somebody buying through us; an SSP is a supply seat — an endpoint we buy
 * from. The same rows answer both questions from different sides, which is why
 * the split rows are read here and the un-split ones are what the P&L uses.
 *
 * These three screens have never had live figures at all: they were reading a
 * checked-in fixture.
 */
export function seatDaysFrom(rows) {
  const out = [];

  const push = (side, idField, nameField, otherField, day, list) => {
    for (const [seat, seatRows] of groupBy(list, (r) => r[nameField] ?? r[idField]).entries()) {
      const revenue = sumOf(seatRows, 'revenue');
      const spend = sumOf(seatRows, 'dsp_spend');
      out.push({
        report_date: day,
        side,
        seat,
        seat_id: String(seatRows[0]?.[idField] ?? seat),
        revenue_cents: cents(revenue),
        cost_cents: cents(spend),
        profit_cents: cents(revenue - spend),
        impressions: Math.round(sumOf(seatRows, 'impressions')),
        requests: Math.round(sumOf(seatRows, 'requests')),
        // How many counterparts it traded with that day: the endpoints a
        // demand seat bought through, or the buyers a supply seat sold to. A
        // seat trading with one counterpart is a different kind of seat from
        // one trading with twelve, whatever the revenue says.
        endpoints: distinct(seatRows, otherField),
      });
    }
  };

  for (const [day, dayRows] of groupBy(rows, (r) => dayOf(r)).entries()) {
    // A demand seat is named by its DSP, a supply seat by its SSP. A row with
    // neither is a total, and belongs to the P&L rather than to a seat.
    push('demand', 'dsp_id', 'dsp_name', 'ssp_id', day, dayRows.filter((r) => r.dsp_id !== null && r.dsp_id !== undefined));
    push('supply', 'ssp_id', 'ssp_name', 'dsp_id', day, dayRows.filter((r) => r.ssp_id !== null && r.ssp_id !== undefined));
  }

  return out.sort((a, b) => a.report_date.localeCompare(b.report_date) || a.seat.localeCompare(b.seat));
}

/* ------------------------------------------------------------------ *
 * Core clients, ranked.
 * ------------------------------------------------------------------ */

/**
 * The accounts that carry the company, from the site detail joined to names.
 *
 * Named by account rather than by site: he thinks in publishers, and one
 * publisher is often a dozen sites. Trading accounts stay in, marked, because
 * they are clients too.
 */
export function coreClientDays(detailRows, accountsById, ignored = new Set()) {
  const kept = (detailRows ?? []).filter(notIgnored(ignored));
  const out = [];
  for (const [day, dayRows] of groupBy(kept, (r) => dayOf(r)).entries()) {
    for (const [accountId, rows] of groupBy(dayRows, 'ars_account_id').entries()) {
      const account = accountsById.get(String(accountId));
      const name = account?.name ?? account?.account_name ?? `Account ${accountId}`;
      out.push({
        account: name,
        date: day,
        is_trading: isTrading(account),
        gross_cents: cents(sumOf(rows, 'gross_revenue')),
        profit_cents: cents(sumOf(rows, 'source_profit_usd')),
        impressions: Math.round(sumOf(rows, 'impressions')),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
}
