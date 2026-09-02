/**
 * The business lines the control panel watches, with no database underneath.
 *
 * Each is a stream of money the company runs, read from the Ad Ops Architect
 * source under its own definition — the same expressions the P&L uses where
 * the two overlap, so a number here agrees with the revenue page rather than
 * being a second, private arithmetic.
 */

export const ACTIVITY_LINES = [
  'core_clients',
  'ibv',
  'rtb_display',
  'apps',
  'ctv',
  'google_ctv',
  'seat_lease',
] as const;
export type ActivityLine = (typeof ACTIVITY_LINES)[number];

export const LINE_LABEL: Record<ActivityLine, string> = {
  core_clients: 'CORE CLIENTS',
  ibv: 'IBV — IN-BANNER VIDEO',
  rtb_display: 'RTB DISPLAY',
  apps: 'APPS',
  ctv: 'CTV',
  google_ctv: 'GOOGLE CTV',
  seat_lease: 'SEAT LEASE',
};

/** What "entities" counts on each line, for the label under the number. */
export const LINE_UNIT: Record<ActivityLine, string | null> = {
  core_clients: 'SITES',
  ibv: 'SITES',
  rtb_display: 'SITES',
  apps: 'APPS',
  ctv: 'ENDPOINTS',
  google_ctv: 'SITES',
  seat_lease: 'PARTNERS',
};

/**
 * Where each line comes from, said on the screen.
 *
 * These are seven different cuts of the business, not seven slices of one
 * pie: core clients is a set of accounts, IBV and RTB display are formats
 * running across all of them, CTV is a device. They overlap on purpose, and
 * adding the tiles up does not give the company — the P&L above them does.
 * Saying so on the tile is the difference between a panel he can act on and
 * one he has to re-derive every time.
 */
export const LINE_SOURCE: Record<ActivityLine, string> = {
  core_clients: 'The core publisher accounts, on the source’s own daily snapshot',
  ibv: 'In-banner and outstream video units across the publisher portfolio',
  rtb_display: 'Display bought through header bidding',
  apps: 'Google Ad Manager, app inventory',
  ctv: 'The exchange, CTV environment',
  google_ctv: 'Google Ad Manager, connected TV and set-top box',
  seat_lease: 'Seat lease partners, on the source’s own economics',
};

export interface LineDay {
  line: ActivityLine;
  date: string;
  grossCents: number;
  profitCents: number;
  impressions: number;
  entities: number | null;
}

export interface LineSummary {
  line: ActivityLine;
  label: string;
  unit: string | null;
  /** The last full day the source has, and its figures. */
  lastDay: string | null;
  grossCents: number;
  profitCents: number;
  impressions: number;
  entities: number | null;
  /** Seven full days ending on lastDay. */
  gross7dCents: number;
  profit7dCents: number;
  /** Against the seven days before those. Null when there is nothing to compare. */
  trendPct: number | null;
  /** Daily gross, oldest first, for the sparkline. */
  series: number[];
  /** True when the source has not delivered a full day in over 48 hours. */
  stale: boolean;
}

/** The day is only complete once the source has stopped revising it. */
export function lastCompleteDay(dates: string[], today: string): string | null {
  const full = dates.filter((d) => d < today).sort();
  return full.at(-1) ?? null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Seven days against the seven before, on gross.
 *
 * Gross rather than profit for the trend, because on several lines the
 * source reports no profit at all (the core snapshot, trading feeds) and a
 * trend on a column of zeroes reads as a collapse.
 */
export function summariseLine(
  line: ActivityLine,
  days: LineDay[],
  today: string,
): LineSummary {
  const sorted = [...days].filter((d) => d.line === line).sort((a, b) => a.date.localeCompare(b.date));
  const full = sorted.filter((d) => d.date < today);
  const last = full.at(-1) ?? null;

  const recent = full.slice(-7);
  const before = full.slice(-14, -7);
  const gross7 = sum(recent.map((d) => d.grossCents));
  const grossBefore = sum(before.map((d) => d.grossCents));

  const stale = last
    ? Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`) > 2 * 86_400_000
    : true;

  return {
    line,
    label: LINE_LABEL[line],
    unit: LINE_UNIT[line],
    lastDay: last?.date ?? null,
    grossCents: last?.grossCents ?? 0,
    profitCents: last?.profitCents ?? 0,
    impressions: last?.impressions ?? 0,
    entities: last?.entities ?? null,
    gross7dCents: gross7,
    profit7dCents: sum(recent.map((d) => d.profitCents)),
    trendPct: before.length === 7 && grossBefore > 0 ? (gross7 - grossBefore) / grossBefore : null,
    series: full.slice(-28).map((d) => d.grossCents),
    stale,
  };
}

export interface CoreClient {
  account: string;
  isTrading: boolean;
  gross7dCents: number;
  profit7dCents: number;
  impressions7d: number;
  /** Against the seven days before. Null when the account was not there. */
  trendPct: number | null;
}

export interface CoreClientDay {
  account: string;
  date: string;
  isTrading: boolean;
  grossCents: number;
  profitCents: number;
  impressions: number;
}

/**
 * The accounts that carry the company, over the last seven full days.
 *
 * Ranked on gross — "who is big" is the question this panel answers, and the
 * publisher's share of gross is what the source calls the account's size.
 * Trading accounts are marked, not excluded: they are clients too, and the
 * mark is what stops a reader comparing their margin to a publisher's.
 */
export function rankCoreClients(days: CoreClientDay[], today: string, limit = 8): CoreClient[] {
  const dates = [...new Set(days.map((d) => d.date))].filter((d) => d < today).sort();
  const recentDates = new Set(dates.slice(-7));
  const beforeDates = new Set(dates.slice(-14, -7));

  const byAccount = new Map<string, CoreClient & { grossBefore: number }>();
  for (const d of days) {
    const inRecent = recentDates.has(d.date);
    const inBefore = beforeDates.has(d.date);
    if (!inRecent && !inBefore) continue;
    const c = byAccount.get(d.account) ?? {
      account: d.account,
      isTrading: d.isTrading,
      gross7dCents: 0,
      profit7dCents: 0,
      impressions7d: 0,
      trendPct: null,
      grossBefore: 0,
    };
    if (inRecent) {
      c.gross7dCents += d.grossCents;
      c.profit7dCents += d.profitCents;
      c.impressions7d += d.impressions;
    } else {
      c.grossBefore += d.grossCents;
    }
    byAccount.set(d.account, c);
  }

  return [...byAccount.values()]
    .filter((c) => c.gross7dCents > 0)
    .sort((a, b) => b.gross7dCents - a.gross7dCents)
    .slice(0, limit)
    .map(({ grossBefore, ...c }) => ({
      ...c,
      trendPct: grossBefore > 0 ? (c.gross7dCents - grossBefore) / grossBefore : null,
    }));
}
