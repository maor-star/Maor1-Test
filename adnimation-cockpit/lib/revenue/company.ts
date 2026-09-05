import { companyDaily, db } from '@/lib/db';
import { rangeFor, type Period, type PeriodRange } from './periods';

/**
 * The company P&L, line by line, reconciled to the source.
 *
 * Every figure here is computed with the SAME expression the Ad Ops Architect
 * system's own reporting functions use, so the cockpit and that app agree to
 * the cent. That reconciliation found two things worth stating plainly:
 *
 * 1. The cockpit's old "net" was wrong. It derived `gross - source_fee`, which
 *    is not a figure the source reports at all. Adnimation's actual revenue on
 *    the publisher business is `netAfterFee - publisherPayout`, where the
 *    payout applies each site's own rev share.
 *
 * 2. The source changed its publisher accounting on 2026-06-04, and the bidder's
 *    on 2026-06-01. The old formula straddled both, which is what made the take
 *    rate appear to jump from ~16% to ~35% in June. It never did — the ~16% was
 *    right all along, and the jump was an artefact of our own arithmetic.
 *
 * Four lines make up the company:
 *   publishers  — managed publisher sites (get_ars_overview_summary)
 *   bidder      — the Vidazoo bidder (get_bidder_profit_total)
 *   seat_lease  — leased SSP seats (get_seat_lease_overview_daily)
 *   exchange    — the XE trading exchange (xe_overview_daily)
 */

export const BUSINESS_LINES = ['publishers', 'bidder', 'seat_lease', 'exchange'] as const;
export type BusinessLineKey = (typeof BUSINESS_LINES)[number];

export const LINE_LABEL: Record<BusinessLineKey, string> = {
  publishers: 'PUBLISHERS',
  bidder: 'BIDDER',
  seat_lease: 'SEAT LEASE',
  exchange: 'EXCHANGE (TRADING)',
};

interface Row {
  date: string;
  pubGross: number;
  pubSourceFee: number;
  pubNetAfterFee: number;
  pubPayout: number;
  pubProfit: number;
  pubImpressions: number;
  bidderGross: number;
  bidderProfit: number;
  bidderImpressions: number;
  seatGross: number;
  seatPayout: number;
  seatProfit: number;
  seatImpressions: number;
  xeRevenue: number;
  xeCost: number;
  xeProfit: number;
  xeImpressions: number;
}

interface Snapshot {
  rows: Row[];
  lastCompleteDay: string;
  partialDay: string;
  pulledAt: string;
  /** True when this came from the synced table rather than the built-in fixture. */
  live: boolean;
}

/** How long a loaded snapshot is trusted before the table is read again. */
const CACHE_MS = 60_000;

let cache: (Snapshot & { loadedAt: number }) | null = null;

/** The fixture, used only until the table has been filled by the sync job. */
async function fromFixture(): Promise<Snapshot> {
  const snap = (await import('@/fixtures/company-daily.json')).default;

  const rows: Row[] = snap.rows.map((r) => ({
    date: r[0] as string,
    pubGross: r[1] as number,
    pubSourceFee: r[2] as number,
    pubNetAfterFee: r[3] as number,
    pubPayout: r[4] as number,
    pubProfit: r[5] as number,
    pubImpressions: r[6] as number,
    bidderGross: r[7] as number,
    bidderProfit: r[8] as number,
    bidderImpressions: r[9] as number,
    seatGross: r[10] as number,
    seatPayout: r[11] as number,
    seatProfit: r[12] as number,
    seatImpressions: r[13] as number,
    xeRevenue: r[14] as number,
    xeCost: r[15] as number,
    xeProfit: r[16] as number,
    xeImpressions: r[17] as number,
  }));

  const partialDay = snap.partialDay;
  const lastComplete = rows.map((r) => r.date).filter((d) => d < partialDay).at(-1) ?? partialDay;
  return { rows, partialDay, lastCompleteDay: lastComplete, pulledAt: snap.pulledAt, live: false };
}

/**
 * The P&L, from the table the sync job writes.
 *
 * The fixture is the fallback, not the source. It exists so a fresh database
 * renders something correct rather than an empty page, and so a failed sync
 * degrades to yesterday's truth instead of a blank screen. Either way the
 * snapshot carries `pulledAt`, and the screen shows it — a stale number that
 * says how stale it is can still be acted on; one that pretends to be current
 * cannot.
 */
async function load(): Promise<Snapshot> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache;

  let snapshot: Snapshot;
  try {
    const rows = await db.select().from(companyDaily).orderBy(companyDaily.date);
    if (rows.length === 0) {
      snapshot = await fromFixture();
    } else {
      const mapped: Row[] = rows.map((r) => ({
        date: r.date,
        pubGross: r.pubGrossCents,
        pubSourceFee: r.pubSourceFeeCents,
        pubNetAfterFee: r.pubNetAfterFeeCents,
        pubPayout: r.pubPayoutCents,
        pubProfit: r.pubProfitCents,
        pubImpressions: r.pubImpressions,
        bidderGross: r.bidderGrossCents,
        bidderProfit: r.bidderProfitCents,
        bidderImpressions: r.bidderImpressions,
        seatGross: r.seatGrossCents,
        seatPayout: r.seatPayoutCents,
        seatProfit: r.seatProfitCents,
        seatImpressions: r.seatImpressions,
        xeRevenue: r.xeRevenueCents,
        xeCost: r.xeCostCents,
        xeProfit: r.xeProfitCents,
        xeImpressions: r.xeImpressions,
      }));

      // The most recent day is always still filling in — the source keeps
      // receiving reports for it for hours after midnight.
      const partialDay = mapped[mapped.length - 1]?.date ?? '';
      const lastComplete =
        mapped.map((r) => r.date).filter((d) => d < partialDay).at(-1) ?? partialDay;
      const pulledAt = rows
        .reduce((a, r) => (r.pulledAt > a ? r.pulledAt : a), new Date(0))
        .toISOString();

      snapshot = { rows: mapped, partialDay, lastCompleteDay: lastComplete, pulledAt, live: true };
    }
  } catch {
    // A database that cannot be reached must not blank the revenue screen.
    snapshot = await fromFixture();
  }

  cache = { ...snapshot, loadedAt: Date.now() };
  return snapshot;
}

/** Gross, profit and impressions for one line over a window. */
export interface LineTotals {
  line: BusinessLineKey;
  label: string;
  grossCents: number;
  profitCents: number;
  /** What was paid out to get that profit — the source fee, payout or DSP cost. */
  costCents: number;
  impressions: number;
  /** Profit as a share of gross. */
  marginPct: number | null;
  /** Share of the company's profit in this window. */
  shareOfProfit: number;
  previousProfitCents: number;
  deltaPct: number | null;
}

export interface CompanyTotals {
  grossCents: number;
  profitCents: number;
  impressions: number;
  days: number;
  marginPct: number | null;
  /** Average profit per day — what makes windows of different lengths comparable. */
  dailyProfitCents: number;
}

function totalsFor(rows: Row[], from: string, to: string) {
  const inRange = rows.filter((r) => r.date >= from && r.date <= to);
  const sum = (f: (r: Row) => number) => inRange.reduce((a, r) => a + f(r), 0);

  const lines: Record<BusinessLineKey, { gross: number; profit: number; cost: number; imps: number }> = {
    publishers: {
      gross: sum((r) => r.pubGross),
      profit: sum((r) => r.pubProfit),
      cost: sum((r) => r.pubSourceFee + r.pubPayout),
      imps: sum((r) => r.pubImpressions),
    },
    bidder: {
      gross: sum((r) => r.bidderGross),
      profit: sum((r) => r.bidderProfit),
      cost: sum((r) => Math.max(0, r.bidderGross - r.bidderProfit)),
      imps: sum((r) => r.bidderImpressions),
    },
    seat_lease: {
      gross: sum((r) => r.seatGross),
      profit: sum((r) => r.seatProfit),
      cost: sum((r) => r.seatPayout),
      imps: sum((r) => r.seatImpressions),
    },
    exchange: {
      gross: sum((r) => r.xeRevenue),
      profit: sum((r) => r.xeProfit),
      cost: sum((r) => r.xeCost),
      imps: sum((r) => r.xeImpressions),
    },
  };

  const days = new Set(inRange.map((r) => r.date)).size;
  return { lines, days };
}

export interface CompanySummary {
  range: PeriodRange;
  company: CompanyTotals;
  previous: CompanyTotals;
  deltaPct: number | null;
  lines: LineTotals[];
  /** Daily company profit and gross, for the chart. */
  series: { date: string; profitCents: number; grossCents: number }[];
  pulledAt: string;
  lastCompleteDay: string;
  partialDay: string;
  /** False while the built-in fixture is standing in for the synced table. */
  live: boolean;
}

function roll(
  lines: ReturnType<typeof totalsFor>['lines'],
  days: number,
): CompanyTotals {
  const grossCents = BUSINESS_LINES.reduce((a, k) => a + lines[k].gross, 0);
  const profitCents = BUSINESS_LINES.reduce((a, k) => a + lines[k].profit, 0);
  const impressions = BUSINESS_LINES.reduce((a, k) => a + lines[k].imps, 0);
  return {
    grossCents,
    profitCents,
    impressions,
    days,
    marginPct: grossCents > 0 ? profitCents / grossCents : null,
    dailyProfitCents: days > 0 ? Math.round(profitCents / days) : 0,
  };
}

export async function summariseCompany(period: Period): Promise<CompanySummary> {
  const snap = await load();
  const range = rangeFor(period, snap.lastCompleteDay, snap.partialDay);

  const now = totalsFor(snap.rows, range.current.from, range.current.to);
  const before = totalsFor(snap.rows, range.previous.from, range.previous.to);

  const company = roll(now.lines, now.days);
  const previous = roll(before.lines, before.days);

  const lines: LineTotals[] = BUSINESS_LINES.map((key) => {
    const l = now.lines[key];
    const p = before.lines[key];
    return {
      line: key,
      label: LINE_LABEL[key],
      grossCents: l.gross,
      profitCents: l.profit,
      costCents: l.cost,
      impressions: l.imps,
      marginPct: l.gross > 0 ? l.profit / l.gross : null,
      shareOfProfit: company.profitCents > 0 ? l.profit / company.profitCents : 0,
      previousProfitCents: p.profit,
      deltaPct: p.profit > 0 ? (l.profit - p.profit) / p.profit : null,
    };
  }).sort((a, b) => b.profitCents - a.profitCents);

  const series = snap.rows
    .filter((r) => r.date >= range.current.from && r.date <= range.current.to)
    .map((r) => ({
      date: r.date,
      profitCents: r.pubProfit + r.bidderProfit + r.seatProfit + r.xeProfit,
      grossCents: r.pubGross + r.bidderGross + r.seatGross + r.xeRevenue,
    }));

  return {
    range,
    company,
    previous,
    deltaPct:
      previous.dailyProfitCents > 0
        ? (company.dailyProfitCents - previous.dailyProfitCents) / previous.dailyProfitCents
        : null,
    lines,
    series,
    pulledAt: snap.pulledAt,
    lastCompleteDay: snap.lastCompleteDay,
    partialDay: snap.partialDay,
    live: snap.live,
  };
}

export async function companyMeta() {
  const snap = await load();
  return {
    lastCompleteDay: snap.lastCompleteDay,
    partialDay: snap.partialDay,
    pulledAt: snap.pulledAt,
    live: snap.live,
  };
}

/**
 * The headline the ticker and the overview both use, so they can never disagree
 * with the revenue page.
 */
export async function headline() {
  const yesterday = await summariseCompany('YESTERDAY');
  const mtd = await summariseCompany('MTD');
  return {
    day: yesterday.lastCompleteDay,
    profitCents: yesterday.company.profitCents,
    grossCents: yesterday.company.grossCents,
    marginPct: yesterday.company.marginPct,
    impressions: yesterday.company.impressions,
    deltaPct: yesterday.deltaPct,
    mtdProfitCents: mtd.company.profitCents,
    lines: yesterday.lines,
    pulledAt: yesterday.pulledAt,
    live: yesterday.live,
  };
}
