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

export const TRADING_PERIODS = ['YESTERDAY', '7D'] as const;
export type TradingPeriod = (typeof TRADING_PERIODS)[number];

export const TRADING_PERIOD_LABEL: Record<TradingPeriod, string> = {
  YESTERDAY: 'YESTERDAY',
  '7D': '7 DAYS',
};

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

function rowsFor(period: TradingPeriod): RawRow[] {
  const window = snapshot.windows[period];
  const ids = new Set<string>(window.chunks);
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

export async function loadTrading(period: TradingPeriod = 'YESTERDAY'): Promise<TradingView> {
  const window = snapshot.windows[period];
  const rows = rowsFor(period);
  const { days, totals } = totalsFor(window.from, window.to);

  return {
    period,
    from: window.from,
    to: window.to,
    days,
    totals,
    bundles: foldBundles(rows),
    routes: foldRoutes(rows),
    buyers: foldSide(rows, (r) => r.buyerCompany),
    sellers: foldSide(rows, (r) => r.sellerCompany),
    waste: waste(),
    meta: {
      source: snapshot.source,
      pulledAt: snapshot.pulledAt,
      lastCompleteDay: snapshot.lastCompleteDay,
      note: snapshot.note,
    },
  };
}
