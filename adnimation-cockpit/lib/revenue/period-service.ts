import { DEFAULT_DEPT_MAPPING, resolveDept } from './mapping';
import { rangeFor, type Period, type PeriodRange } from './periods';
import { ecpmCents, takeRate } from './normalize';
import type { BusinessLine } from './types';

/**
 * Revenue over a time window.
 *
 * Two sources, both real, chosen so every window is exact rather than
 * interpolated:
 *  - daily company totals, for any window's headline figure;
 *  - monthly figures per demand category, for the department split on the
 *    to-date windows, which all begin on a month boundary.
 * The 35-day daily-by-category snapshot covers the department split for the
 * short windows.
 */

interface DailyTotal { date: string; grossCents: number; feeCents: number; impressions: number }
interface MonthlyCategory {
  month: string; category: string; grossCents: number; feeCents: number; impressions: number;
}

let dailyCache: DailyTotal[] | null = null;
let monthlyCache: MonthlyCategory[] | null = null;

async function loadDaily(): Promise<DailyTotal[]> {
  if (dailyCache) return dailyCache;
  const snap = (await import('@/fixtures/ars-daily-totals.json')).default;
  dailyCache = snap.rows.map((r) => ({
    date: r[0] as string,
    grossCents: r[1] as number,
    feeCents: r[2] as number,
    impressions: r[3] as number,
  }));
  return dailyCache;
}

async function loadMonthly(): Promise<MonthlyCategory[]> {
  if (monthlyCache) return monthlyCache;
  const snap = (await import('@/fixtures/ars-monthly-by-category.json')).default;
  monthlyCache = snap.rows.map((r) => ({
    month: r[0] as string,
    category: r[1] as string,
    grossCents: r[2] as number,
    feeCents: r[3] as number,
    impressions: r[4] as number,
  }));
  return monthlyCache;
}

export interface WindowTotals {
  grossCents: number;
  netCents: number;
  impressions: number;
  days: number;
  ecpmCents: number | null;
  takeRate: number | null;
  /** Average net per day — the figure that makes windows of different lengths comparable. */
  dailyNetCents: number;
}

function totalsOver(rows: DailyTotal[], from: string, to: string): WindowTotals {
  const inRange = rows.filter((r) => r.date >= from && r.date <= to);
  const grossCents = inRange.reduce((a, r) => a + r.grossCents, 0);
  const feeCents = inRange.reduce((a, r) => a + r.feeCents, 0);
  const impressions = inRange.reduce((a, r) => a + r.impressions, 0);
  const netCents = grossCents - feeCents;
  const days = inRange.length;
  return {
    grossCents,
    netCents,
    impressions,
    days,
    ecpmCents: ecpmCents(netCents, impressions),
    takeRate: takeRate(grossCents, netCents),
    dailyNetCents: days > 0 ? Math.round(netCents / days) : 0,
  };
}

export interface DeptWindow {
  deptCode: string | null;
  label: string;
  grossCents: number;
  netCents: number;
  impressions: number;
  ecpmCents: number | null;
  categories: { category: string; businessLine: BusinessLine; netCents: number }[];
}

/**
 * Department split for a window. Uses monthly category figures, which line up
 * exactly with MTD/QTD/YTD; short windows that do not start on the first of a
 * month fall back to whole months that overlap the window, and the caller is
 * told so via `exact`.
 */
async function deptsOver(from: string, to: string): Promise<{ depts: DeptWindow[]; exact: boolean }> {
  const monthly = await loadMonthly();
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const exact = from.endsWith('-01');

  const rows = monthly.filter((m) => m.month >= fromMonth && m.month <= toMonth);
  const byDept = new Map<string, DeptWindow>();

  for (const r of rows) {
    // The source's category rows are all managed-publisher business here;
    // the trading split only exists in the daily snapshot.
    const businessLine: BusinessLine = 'publisher';
    const assignment = resolveDept(businessLine, r.category, DEFAULT_DEPT_MAPPING);
    const key = assignment.deptCode ?? 'UNASSIGNED';
    const existing = byDept.get(key) ?? {
      deptCode: assignment.deptCode,
      label: key,
      grossCents: 0,
      netCents: 0,
      impressions: 0,
      ecpmCents: null,
      categories: [],
    };
    existing.grossCents += r.grossCents;
    existing.netCents += r.grossCents - r.feeCents;
    existing.impressions += r.impressions;
    const cat = existing.categories.find((c) => c.category === r.category);
    if (cat) cat.netCents += r.grossCents - r.feeCents;
    else existing.categories.push({ category: r.category, businessLine, netCents: r.grossCents - r.feeCents });
    byDept.set(key, existing);
  }

  const depts = [...byDept.values()]
    .map((d) => ({ ...d, ecpmCents: ecpmCents(d.netCents, d.impressions) }))
    .sort((a, b) => b.netCents - a.netCents);

  return { depts, exact };
}

export interface PeriodSummary {
  range: PeriodRange;
  current: WindowTotals;
  previous: WindowTotals;
  /** Change in average daily net, so windows of unequal length compare fairly. */
  deltaPct: number | null;
  depts: DeptWindow[];
  deptsExact: boolean;
  /** Daily net for the window, for the chart. */
  series: { date: string; netCents: number; grossCents: number }[];
}

export async function summariseForPeriod(
  period: Period,
  lastCompleteDay: string,
): Promise<PeriodSummary> {
  const daily = await loadDaily();
  const range = rangeFor(period, lastCompleteDay);

  const current = totalsOver(daily, range.current.from, range.current.to);
  const previous = totalsOver(daily, range.previous.from, range.previous.to);

  // Compared on average daily net: a to-date window and its comparison can
  // still differ in days when the source is missing a day.
  const deltaPct =
    previous.dailyNetCents > 0
      ? (current.dailyNetCents - previous.dailyNetCents) / previous.dailyNetCents
      : null;

  const { depts, exact } = await deptsOver(range.current.from, range.current.to);

  const series = daily
    .filter((r) => r.date >= range.current.from && r.date <= range.current.to)
    .map((r) => ({ date: r.date, netCents: r.grossCents - r.feeCents, grossCents: r.grossCents }));

  return { range, current, previous, deltaPct, depts, deptsExact: exact, series };
}

/** The most recent day the source has data for. */
export async function lastCompleteDay(): Promise<string | null> {
  const daily = await loadDaily();
  return daily.at(-1)?.date ?? null;
}
