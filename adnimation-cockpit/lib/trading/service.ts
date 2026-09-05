/**
 * Trading — the exchange desk.
 *
 * Where the rest of the cockpit asks "how much did we make", this module asks
 * the trader's question: on which bundle, sold by whom, bought by whom, through
 * which endpoint, and at what margin. It also asks the inverse, which is the
 * expensive one: which supply is pouring requests into demand that never buys.
 *
 * The source table is 5 GB and cannot aggregate a month inside the query
 * timeout, so the fixture holds chunked pulls of the bundle/seller/buyer rows
 * that cleared a small profit floor. That is enough to rank the money and never
 * enough to be a ledger — so window totals come from the same daily accounting
 * the Demand page uses, and the ranked rows are always presented as a top list.
 */

import snapshot from '@/fixtures/trading.json';
import { PERIODS, PERIOD_TAB, rangeFor, type Period } from '@/lib/revenue/periods';
import { db, seatDays } from '@/lib/db';
import { todayInTz } from '@/lib/utils';

/**
 * Every window the rest of the cockpit offers, not two.
 *
 * It was YESTERDAY and 7 DAYS, because the whole page was a checked-in
 * snapshot with exactly those two windows baked into it. The desk's own
 * figures now come from `seat_days`, which holds every seat on both sides for
 * every day of the year, so a month or a quarter is the same question asked
 * over more rows.
 */
export const TRADING_PERIODS = PERIODS;
export type TradingPeriod = Period;

export const TRADING_PERIOD_LABEL = PERIOD_TAB;

/** Below this, a demand endpoint is taking the requests and not buying. */
export const DEAD_REVENUE_PER_M_CENTS = 100;

const toCents = (n: number) => Math.round(n * 100);
const marginPct = (revenueCents: number, profitCents: number) =>
  revenueCents === 0 ? 0 : (profitCents / revenueCents) * 100;

interface RawRow {
  bundle: string;
  sellerCompany: string;
  sellerEndpoint: string;
  buyerCompany: string;
  buyerEndpoint: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  impressions: number;
  requests: number;
}

export interface TradingRoute {
  sellerCompany: string;
  sellerEndpoint: string;
  buyerCompany: string;
  buyerEndpoint: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  impressions: number;
  requests: number;
  marginPct: number;
  bundles: number;
}

export interface TradingBundle {
  bundle: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  impressions: number;
  requests: number;
  marginPct: number;
  /** Who bought it, best first — the demand side of the trade. */
  buyers: { name: string; profitCents: number }[];
  /** Who sold it, best first — the supply side. */
  sellers: { name: string; profitCents: number }[];
  /** The single endpoint pair that carried most of the money. */
  topRoute: TradingRoute;
  routes: number;
}

export interface WasteRow {
  sellerCompany: string;
  buyerCompany: string;
  requests: number;
  impressions: number;
  revenueCents: number;
  profitCents: number;
  bundles: number;
  /** Revenue earned per million requests sent — the whole point of the row. */
  revenuePerMillionCents: number;
  dead: boolean;
}

export interface TradingView {
  period: TradingPeriod;
  from: string;
  to: string;
  days: number;
  /**
   * The window the ranked bundles, routes and waste actually cover.
   *
   * They are the one part of this page still read from the checked-in
   * snapshot: the bundle grain is a five-gigabyte table that cannot be
   * aggregated inside the query timeout, and nothing syncs it yet. So they do
   * NOT follow the selector, and the screen says so where they are shown —
   * a ranked list quietly answering for a different fortnight is worse than
   * no list at all.
   */
  snapshotWindow: { from: string; to: string };
  totals: {
    revenueCents: number;
    costCents: number;
    profitCents: number;
    marginPct: number;
    requests: number;
    impressions: number;
  };
  bundles: TradingBundle[];
  routes: TradingRoute[];
  buyers: { name: string; revenueCents: number; profitCents: number; marginPct: number }[];
  sellers: { name: string; revenueCents: number; profitCents: number; marginPct: number }[];
  waste: {
    date: string;
    minRequests: number;
    rows: WasteRow[];
    deadRequests: number;
    totalRequests: number;
  };
  meta: { source: string; pulledAt: string; lastCompleteDay: string; note: string };
}

/**
 * The ranked rows the snapshot holds, over the widest window it has.
 *
 * It used to be asked for the chosen period, which only worked while the page
 * offered exactly the two periods the snapshot was built with. It now always
 * answers for its own seven days, and the screen labels them as such.
 */
function rowsFor(): RawRow[] {
  const ids = new Set<string>(snapshot.windows['7D'].chunks);
  const out: RawRow[] = [];

  for (const chunk of snapshot.chunks) {
    if (!ids.has(chunk.id)) continue;
    for (const r of chunk.rows) {
      out.push({
        bundle: String(r[0]),
        sellerCompany: String(r[1]),
        sellerEndpoint: String(r[2]),
        buyerCompany: String(r[3]),
        buyerEndpoint: String(r[4]),
        revenueCents: toCents(Number(r[5])),
        costCents: toCents(Number(r[6])),
        profitCents: toCents(Number(r[7])),
        impressions: Number(r[8]),
        requests: Number(r[9]),
      });
    }
  }
  return out;
}

/** Sum the rows that share a seller endpoint and a buyer endpoint. */
function foldRoutes(rows: RawRow[]): TradingRoute[] {
  const by = new Map<string, TradingRoute & { bundleSet: Set<string> }>();

  for (const r of rows) {
    const key = `${r.sellerCompany} ${r.sellerEndpoint} ${r.buyerCompany} ${r.buyerEndpoint}`;
    const cur = by.get(key);
    if (cur) {
      cur.revenueCents += r.revenueCents;
      cur.costCents += r.costCents;
      cur.profitCents += r.profitCents;
      cur.impressions += r.impressions;
      cur.requests += r.requests;
      cur.bundleSet.add(r.bundle);
      continue;
    }
    by.set(key, {
      sellerCompany: r.sellerCompany,
      sellerEndpoint: r.sellerEndpoint,
      buyerCompany: r.buyerCompany,
      buyerEndpoint: r.buyerEndpoint,
      revenueCents: r.revenueCents,
      costCents: r.costCents,
      profitCents: r.profitCents,
      impressions: r.impressions,
      requests: r.requests,
      marginPct: 0,
      bundles: 0,
      bundleSet: new Set([r.bundle]),
    });
  }

  return [...by.values()]
    .map(({ bundleSet, ...route }) => ({
      ...route,
      bundles: bundleSet.size,
      marginPct: marginPct(route.revenueCents, route.profitCents),
    }))
    .sort((a, b) => b.profitCents - a.profitCents);
}

function foldBundles(rows: RawRow[]): TradingBundle[] {
  const by = new Map<string, RawRow[]>();
  for (const r of rows) by.set(r.bundle, [...(by.get(r.bundle) ?? []), r]);

  const bundles: TradingBundle[] = [];
  for (const [bundle, group] of by) {
    const revenueCents = group.reduce((a, r) => a + r.revenueCents, 0);
    const costCents = group.reduce((a, r) => a + r.costCents, 0);
    const profitCents = group.reduce((a, r) => a + r.profitCents, 0);
    const routes = foldRoutes(group);
    const topRoute = routes[0];
    if (!topRoute) continue;

    const side = (pick: (r: RawRow) => string) => {
      const m = new Map<string, number>();
      for (const r of group) m.set(pick(r), (m.get(pick(r)) ?? 0) + r.profitCents);
      return [...m.entries()]
        .map(([name, p]) => ({ name, profitCents: p }))
        .sort((a, b) => b.profitCents - a.profitCents);
    };

    bundles.push({
      bundle,
      revenueCents,
      costCents,
      profitCents,
      impressions: group.reduce((a, r) => a + r.impressions, 0),
      requests: group.reduce((a, r) => a + r.requests, 0),
      marginPct: marginPct(revenueCents, profitCents),
      buyers: side((r) => r.buyerCompany),
      sellers: side((r) => r.sellerCompany),
      topRoute,
      routes: routes.length,
    });
  }

  return bundles.sort((a, b) => b.profitCents - a.profitCents);
}

function foldSide(rows: RawRow[], pick: (r: RawRow) => string) {
  const m = new Map<string, { revenueCents: number; profitCents: number }>();
  for (const r of rows) {
    const k = pick(r);
    const cur = m.get(k) ?? { revenueCents: 0, profitCents: 0 };
    cur.revenueCents += r.revenueCents;
    cur.profitCents += r.profitCents;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([name, v]) => ({ ...v, name, marginPct: marginPct(v.revenueCents, v.profitCents) }))
    .sort((a, b) => b.profitCents - a.profitCents);
}

function totalsFor(from: string, to: string) {
  let revenueCents = 0;
  let costCents = 0;
  let profitCents = 0;
  let requests = 0;
  let impressions = 0;
  let days = 0;

  for (const row of snapshot.dailyTotals) {
    const date = String(row[0]);
    if (date < from || date > to) continue;
    days += 1;
    revenueCents += toCents(Number(row[1]));
    costCents += toCents(Number(row[2]));
    profitCents += toCents(Number(row[3]));
    requests += Number(row[4]);
    impressions += Number(row[5]);
  }

  return {
    days,
    totals: {
      revenueCents,
      costCents,
      profitCents,
      marginPct: marginPct(revenueCents, profitCents),
      requests,
      impressions,
    },
  };
}

function waste() {
  const rows: WasteRow[] = snapshot.waste.pairs.map((p) => {
    const requests = Number(p[5]);
    const revenueCents = toCents(Number(p[2]));
    const revenuePerMillionCents =
      requests === 0 ? 0 : Math.round((revenueCents / requests) * 1_000_000);

    return {
      sellerCompany: String(p[0]),
      buyerCompany: String(p[1]),
      revenueCents,
      profitCents: toCents(Number(p[3])),
      impressions: Number(p[4]),
      requests,
      bundles: Number(p[6]),
      revenuePerMillionCents,
      dead: revenuePerMillionCents < DEAD_REVENUE_PER_M_CENTS,
    };
  });

  rows.sort((a, b) => b.requests - a.requests);

  return {
    date: snapshot.waste.date,
    minRequests: snapshot.waste.minRequests,
    rows,
    deadRequests: rows.filter((r) => r.dead).reduce((a, r) => a + r.requests, 0),
    totalRequests: rows.reduce((a, r) => a + r.requests, 0),
  };
}

/**
 * The desk's own figures for a window, from the seats.
 *
 * A demand seat is a buyer and a supply seat is a seller, and the two sides
 * are the same trades counted from opposite ends — so the totals are taken
 * from the demand side alone. Adding both would report the exchange at twice
 * its size, which is the same mistake the P&L makes if it reads the pair rows.
 */
async function liveDesk(from: string, to: string) {
  const rows = await db
    .select({
      side: seatDays.side,
      seat: seatDays.seat,
      date: seatDays.reportDate,
      revenueCents: seatDays.revenueCents,
      costCents: seatDays.costCents,
      profitCents: seatDays.profitCents,
      impressions: seatDays.impressions,
      requests: seatDays.requests,
    })
    .from(seatDays)
    .catch(() => []);

  const inWindow = rows.filter((r) => r.date >= from && r.date <= to);
  if (inWindow.length === 0) return null;

  const fold = (side: string) => {
    const m = new Map<string, { revenueCents: number; profitCents: number }>();
    for (const r of inWindow) {
      if (r.side !== side) continue;
      const cur = m.get(r.seat) ?? { revenueCents: 0, profitCents: 0 };
      cur.revenueCents += r.revenueCents;
      cur.profitCents += r.profitCents;
      m.set(r.seat, cur);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ ...v, name, marginPct: marginPct(v.revenueCents, v.profitCents) }))
      .sort((a, b) => b.profitCents - a.profitCents);
  };

  const demand = inWindow.filter((r) => r.side === 'demand');
  const revenueCents = demand.reduce((a, r) => a + r.revenueCents, 0);
  const profitCents = demand.reduce((a, r) => a + r.profitCents, 0);

  return {
    days: new Set(demand.map((r) => r.date)).size,
    totals: {
      revenueCents,
      costCents: demand.reduce((a, r) => a + r.costCents, 0),
      profitCents,
      marginPct: marginPct(revenueCents, profitCents),
      requests: demand.reduce((a, r) => a + r.requests, 0),
      impressions: demand.reduce((a, r) => a + r.impressions, 0),
    },
    buyers: fold('demand'),
    sellers: fold('supply'),
  };
}

export async function loadTrading(period: TradingPeriod = 'YESTERDAY'): Promise<TradingView> {
  const rows = rowsFor();
  const snapshotWindow = { from: snapshot.windows['7D'].from, to: snapshot.windows['7D'].to };

  const range = rangeFor(period, snapshot.lastCompleteDay, todayInTz());
  const from = range.current.from;
  const to = range.current.to;

  /*
   * Live where there is live data, the snapshot where there is not. The
   * snapshot's own two windows are the only ones it can answer, so falling
   * back to it for any other period would answer a month with a day.
   */
  const live = await liveDesk(from, to);

  /*
   * With no seat rows — a fresh install, or a window the sync has not reached
   * — fall back to the snapshot's own accounting. It can answer the two
   * windows it was built with and nothing else, so anything wider falls back
   * to its week rather than reporting a quarter as though it were seven days.
   */
  const windows = snapshot.windows as Record<string, { from: string; to: string }>;
  const fallbackWindow = windows[period] ?? snapshotWindow;
  const fallback = totalsFor(fallbackWindow.from, fallbackWindow.to);

  return {
    period,
    from: live ? from : fallbackWindow.from,
    to: live ? to : fallbackWindow.to,
    days: live ? live.days : fallback.days,
    snapshotWindow,
    totals: live ? live.totals : fallback.totals,
    bundles: foldBundles(rows),
    routes: foldRoutes(rows),
    buyers: live ? live.buyers : foldSide(rows, (r) => r.buyerCompany),
    sellers: live ? live.sellers : foldSide(rows, (r) => r.sellerCompany),
    waste: waste(),
    meta: {
      source: snapshot.source,
      pulledAt: snapshot.pulledAt,
      lastCompleteDay: snapshot.lastCompleteDay,
      note: snapshot.note,
    },
  };
}
