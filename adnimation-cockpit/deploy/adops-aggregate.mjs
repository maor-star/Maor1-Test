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
 * The P&L's four books, and the columns each one owns.
 *
 * Grouped rather than listed flat because a book the source refuses must not
 * be written at all. Flat, every column of every book went into one row and a
 * refused book arrived as a column of zeroes — which is how the publisher and
 * seat-lease books were wiped for the last twelve days of August the first
 * time the source closed its two reports. On the screen a denied grant and a
 * business that stopped look exactly alike.
 */
export const PL_BOOKS = {
  publishers: [
    'pub_gross_cents', 'pub_source_fee_cents', 'pub_net_after_fee_cents', 'pub_payout_cents',
    'pub_profit_cents', 'pub_impressions',
  ],
  bidder: ['bidder_gross_cents', 'bidder_profit_cents', 'bidder_impressions'],
  seat: ['seat_gross_cents', 'seat_payout_cents', 'seat_profit_cents', 'seat_impressions'],
  exchange: ['xe_revenue_cents', 'xe_cost_cents', 'xe_profit_cents', 'xe_impressions'],
};

export const PL_NUMERIC = Object.values(PL_BOOKS).flat();

/**
 * One row per day, out of the books that actually came back.
 *
 * `books` maps a book's name to its days, or to null when the source refused
 * it. A book that answered writes its columns, including a real zero on a day
 * it earned nothing — a line that reported nothing that day earned nothing,
 * and leaving it undefined would drop the day out of a SUM further up. A book
 * that was refused writes no columns at all, and the returned `columns` list
 * is what the upsert is allowed to touch, so yesterday's correct figures stay
 * where they are and the screen labels their age.
 */
export function mergeDays(books, pulledAt) {
  const columns = [];
  const empty = [];
  for (const [name, days] of Object.entries(books)) {
    if (days === null) continue;
    if (!bookHasMoney(days)) {
      empty.push(name);
      continue;
    }
    columns.push(...PL_BOOKS[name]);
  }

  const byDate = new Map();
  for (const days of Object.values(books)) {
    for (const row of days ?? []) {
      if (!row?.date) continue;
      const target = byDate.get(row.date) ?? { date: row.date };
      for (const [k, v] of Object.entries(row)) {
        if (k !== 'date' && columns.includes(k)) target[k] = Number(v ?? 0);
      }
      byDate.set(row.date, target);
    }
  }

  const rows = [...byDate.values()]
    .map((r) => {
      const full = { date: r.date, source: 'adops', pulled_at: pulledAt };
      for (const k of columns) full[k] = Number.isFinite(r[k]) ? r[k] : 0;
      return full;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, columns, empty };
}


/** A book the source refused, so the upsert leaves its columns alone. */
export const bookOrNull = (rows, denied) => (denied ? null : rows);

/**
 * A book that came back but adds up to nothing is not a book.
 *
 * A window in which one of the four earned zero across every day does not
 * happen; a column left out of the SELECT does. That is exactly how the
 * publisher book was written with the right gross and a margin of zero — the
 * detail read was missing `publisher_revenue`, so net-after-fee and profit
 * were both computed from a column that was not there, and it wrote silently.
 *
 * So a book whose money is entirely zero is dropped here rather than written:
 * the day keeps the figures it already had, and the run says which book and
 * why. Loud and wrong beats quiet and wrong on the screen he runs on.
 */
export function bookHasMoney(rows) {
  return (rows ?? []).some((r) =>
    Object.entries(r).some(([k, v]) => k.endsWith('_cents') && Number(v) !== 0),
  );
}


/**
 * Publishers, from the source's own overview report.
 *
 * Kept for the day the report is opened up again. As of today it answers
 * "platform_only: this data is served through the application, not directly"
 * — a deliberate block, not a lapsed grant — so the book is built from the
 * site detail below instead.
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

/**
 * What Adnimation keeps on each site, as at a given day.
 *
 * `rev_share_pct` is OUR share, not the publisher's — which is the opposite of
 * what the column name suggests and worth pinning here, because reading it the
 * other way turns a 16% margin into an 84% one.
 *
 * Shares change, and each row is the share from its effective date onward, so
 * the answer depends on the day being priced: a rate agreed in July must not
 * be applied to January.
 */
export function revShareLookup(shareRows) {
  const bySite = new Map();
  for (const row of shareRows ?? []) {
    const site = String(row.ars_site_id);
    const list = bySite.get(site) ?? [];
    list.push({ from: String(row.effective_date ?? '').slice(0, 10), pct: num(row.rev_share_pct) });
    bySite.set(site, list);
  }
  for (const list of bySite.values()) list.sort((a, b) => a.from.localeCompare(b.from));

  return (siteId, date) => {
    const list = bySite.get(String(siteId));
    if (!list) return null;
    let pct = null;
    for (const entry of list) {
      if (entry.from > date) break;
      pct = entry.pct;
    }
    return pct;
  };
}

/**
 * The publisher book of the P&L, rebuilt from the site detail.
 *
 * Every column checked against what the source's own report returned for
 * 24 August, the last day it answered before it was closed: gross 23,392
 * against 23,393, the demand sources' fee 749 against 749, net after fee
 * 22,643 against 22,643, our profit 3,534 against 3,533 and the publishers'
 * payout 19,110 against 19,110. The cents differ; nothing else does.
 *
 * Trading accounts are out, because the report had them out: they are bought
 * and resold rather than represented, and the P&L keeps them apart.
 *
 * A site with no rev share recorded contributes no profit rather than all of
 * it. Twenty of five hundred sites are in that state on a given day, and they
 * are small; assuming a hundred per cent margin on them would flatter the
 * book, which is the wrong way for a figure like this to be wrong.
 */
export function publishersDaysFromDetail(detailRows, accountsById, ignored, shareAt) {
  const kept = (detailRows ?? [])
    .filter(notIgnored(ignored))
    .filter((r) => !isTrading(accountsById.get(String(r.ars_account_id))));

  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) => {
      const netAfterFee = sumOf(day, 'publisher_revenue');
      const profit = day.reduce((a, r) => {
        const pct = shareAt(r.ars_site_id, date);
        return a + (pct === null ? 0 : num(r.publisher_revenue) * (pct / 100));
      }, 0);
      return {
        date,
        pub_gross_cents: cents(sumOf(day, 'gross_revenue')),
        // The demand source's cut, which is what the report called its fee.
        pub_source_fee_cents: cents(sumOf(day, 'source_profit_usd')),
        pub_net_after_fee_cents: cents(netAfterFee),
        pub_payout_cents: cents(netAfterFee - profit),
        pub_profit_cents: cents(profit),
        pub_impressions: Math.round(sumOf(day, 'impressions')),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
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
 * How far back the cockpit reports: twelve months, rolling.
 *
 * It was a fixed 2026-01-01 when he asked for "this year only". He then asked
 * for a year back, which is not the same thing in September — it reaches into
 * the previous autumn — so the floor moves with the calendar instead of
 * standing on New Year's Day.
 *
 * It is still a floor and not a suggestion: every window any sync builds is
 * clamped to it, so a stray argument or an old default cannot walk the whole
 * of the source's history again. That run is the one he stopped.
 */
export const HISTORY_DAYS = 365;

/** The earliest day any sync may ask the source for, given today. */
export function historyFloor(today) {
  const t = Date.parse(`${today}T00:00:00Z`);
  return new Date(t - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** A window, never reaching further back than the twelve months he asked for. */
export function clampToHistory(from, today) {
  const floor = historyFloor(today);
  return from < floor ? floor : from;
}

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
export function coreClientsLine(detailRows, accountsById = new Map(), ignored = new Set(), shareAt = null) {
  const kept = (detailRows ?? [])
    .filter(notIgnored(ignored))
    .filter((r) => !isTrading(accountsById.get(String(r.ars_account_id))));

  return [...groupBy(kept, (r) => dayOf(r)).entries()]
    .map(([date, day]) =>
      lineDay(date, {
        gross: sumOf(day, 'gross_revenue'),
        /*
         * Adnimation's own margin, the same figure the P&L's publisher book
         * carries — not `source_profit_usd`, which is the DEMAND SOURCE's cut
         * and about a fifth the size. The tile that says what this line earns
         * has to agree with the P&L above it, or he has two answers to one
         * question and no way to tell which is his.
         */
        profit: shareAt
          ? day.reduce((a, r) => {
              const pct = shareAt(r.ars_site_id, date);
              return a + (pct === null ? 0 : num(r.publisher_revenue) * (pct / 100));
            }, 0)
          : sumOf(day, 'source_profit_usd'),
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

/** A JSON flag the source writes as either a boolean or the string "true". */
const isOn = (v) => v === true || String(v ?? '').toLowerCase() === 'true';

/** A name that says CTV or OTT as a word of its own, not inside another word. */
const CTV_IN_NAME = /(^|[^a-z])(ctv|ott)([^a-z]|$)/i;

/**
 * Which environment a demand endpoint sells into.
 *
 * This is the source's own rule, ported rather than invented — it is the
 * CASE in its `xe_endpoint_dim` view, in the same order, and it agrees with
 * that view on every one of the 380 demand endpoints it has.
 *
 * It is ported because the view itself is denied to this sign-in and the
 * table underneath it is not. Two of the view's five branches are left out —
 * a manual override table and a bundle-share heuristic — and both are empty
 * of demand endpoints today, which is why the two still agree. If the ad ops
 * team starts overriding an endpoint by hand, this will not see it, and the
 * fix is a grant on the view rather than more rules here.
 *
 * Order matters: an endpoint that sells in-app AND on the web is WEB, and one
 * that targets televisions only is CTV whatever its environments say.
 */
export function environmentOf(endpoint) {
  const device = endpoint?.targeting?.device ?? {};
  if (isOn(device.ctv) && !isOn(device.mobile) && !isOn(device.desktop)) return 'CTV';
  if (CTV_IN_NAME.test(String(endpoint?.name ?? ''))) return 'CTV';

  const env = endpoint?.environments ?? {};
  if (isOn(env.inapp) && !isOn(env.web)) return 'INAPP';
  if (isOn(env.web)) return 'WEB';
  return null;
}

/** The environment of each demand endpoint, by its id. */
export function endpointEnvironments(endpointRows) {
  const out = new Map();
  for (const row of endpointRows ?? []) {
    // Supply endpoints carry an environment too, and it is the wrong one to
    // read: the tile is about where the buyer is spending.
    if (String(row.kind ?? row.endpoint_kind ?? '') !== 'dsp') continue;
    const env = row.environment ? String(row.environment).toUpperCase() : environmentOf(row);
    if (env) out.set(String(row.id ?? row.endpoint_id), env);
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
