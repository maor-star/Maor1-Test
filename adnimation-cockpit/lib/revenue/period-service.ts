import { departmentFor, departmentLabel } from './departments';
import { rangeFor, type Period, type PeriodRange } from './periods';
import { ecpmCents, takeRate } from './normalize';

/**
 * Revenue over a time window, from one source of truth.
 *
 * `ars-daily-by-category.json` is a read-only pull of the Ad Ops Architect
 * system's own daily rollup, one row per day per demand category, for the whole
 * year to date. Because it is daily *and* by category, every window — today,
 * yesterday, 7D, 30D, MTD, QTD, last quarter, YTD — is summed exactly from real
 * rows, with the department split intact. Nothing is interpolated and no window
 * falls back to whole months.
 */

interface Row {
  date: string;
  dept: string;
  grossCents: number;
  feeCents: number;
  impressions: number;
}

interface Snapshot {
  rows: Row[];
  /** The day the source is still receiving data for — always incomplete. */
  partialDay: string;
  lastCompleteDay: string;
  pulledAt: string;
}

let cache: Snapshot | null = null;

async function load(): Promise<Snapshot> {
  if (cache) return cache;
  const snap = (await import('@/fixtures/ars-daily-by-category.json')).default;

  const rows: Row[] = snap.rows.map((r) => ({
    date: r[0] as string,
    dept: departmentFor(r[1] as string),
    grossCents: r[2] as number,
    feeCents: r[3] as number,
    impressions: r[4] as number,
  }));

  const partialDay = snap.partialDay;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const lastComplete = dates.filter((d) => d < partialDay).at(-1) ?? partialDay;

  cache = { rows, partialDay, lastCompleteDay: lastComplete, pulledAt: snap.pulledAt };
  return cache;
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

function totalsOver(rows: Row[], from: string, to: string): WindowTotals {
  const inRange = rows.filter((r) => r.date >= from && r.date <= to);
  const grossCents = inRange.reduce((a, r) => a + r.grossCents, 0);
  const feeCents = inRange.reduce((a, r) => a + r.feeCents, 0);
  const impressions = inRange.reduce((a, r) => a + r.impressions, 0);
  const netCents = grossCents - feeCents;
  const days = new Set(inRange.map((r) => r.date)).size;
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
  deptCode: string;
  label: string;
  grossCents: number;
  netCents: number;
  impressions: number;
  ecpmCents: number | null;
  takeRate: number | null;
  /** Net in the comparison window, so each department carries its own delta. */
  previousNetCents: number;
  deltaPct: number | null;
  /** Share of the window's net. */
  share: number;
}

function deptsOver(
  rows: Row[],
  current: { from: string; to: string },
  previous: { from: string; to: string },
): DeptWindow[] {
  const sum = (from: string, to: string) => {
    const acc = new Map<string, { g: number; f: number; i: number }>();
    for (const r of rows) {
      if (r.date < from || r.date > to) continue;
      const e = acc.get(r.dept) ?? { g: 0, f: 0, i: 0 };
      e.g += r.grossCents;
      e.f += r.feeCents;
      e.i += r.impressions;
      acc.set(r.dept, e);
    }
    return acc;
  };

  const now = sum(current.from, current.to);
  const before = sum(previous.from, previous.to);
  const totalNet = [...now.values()].reduce((a, v) => a + (v.g - v.f), 0);

  return [...now.entries()]
    .map(([dept, v]) => {
      const netCents = v.g - v.f;
      const prev = before.get(dept);
      const previousNetCents = prev ? prev.g - prev.f : 0;
      return {
        deptCode: dept,
        label: departmentLabel(dept),
        grossCents: v.g,
        netCents,
        impressions: v.i,
        ecpmCents: ecpmCents(netCents, v.i),
        takeRate: takeRate(v.g, netCents),
        previousNetCents,
        deltaPct: previousNetCents > 0 ? (netCents - previousNetCents) / previousNetCents : null,
        share: totalNet > 0 ? netCents / totalNet : 0,
      };
    })
    .sort((a, b) => b.netCents - a.netCents);
}

export interface PeriodSummary {
  range: PeriodRange;
  current: WindowTotals;
  previous: WindowTotals;
  /** Change in average daily net, so windows of unequal length compare fairly. */
  deltaPct: number | null;
  depts: DeptWindow[];
  /** Daily net for the window, for the chart. */
  series: { date: string; netCents: number; grossCents: number }[];
  pulledAt: string;
}

export async function summariseForPeriod(
  period: Period,
  lastComplete?: string,
): Promise<PeriodSummary> {
  const snap = await load();
  const range = rangeFor(period, lastComplete ?? snap.lastCompleteDay, snap.partialDay);

  const current = totalsOver(snap.rows, range.current.from, range.current.to);
  const previous = totalsOver(snap.rows, range.previous.from, range.previous.to);

  // Compared on average daily net: a to-date window and its comparison can
  // still differ in days when the source is missing a day.
  const deltaPct =
    previous.dailyNetCents > 0
      ? (current.dailyNetCents - previous.dailyNetCents) / previous.dailyNetCents
      : null;

  const byDate = new Map<string, { net: number; gross: number }>();
  for (const r of snap.rows) {
    if (r.date < range.current.from || r.date > range.current.to) continue;
    const e = byDate.get(r.date) ?? { net: 0, gross: 0 };
    e.net += r.grossCents - r.feeCents;
    e.gross += r.grossCents;
    byDate.set(r.date, e);
  }

  return {
    range,
    current,
    previous,
    deltaPct,
    depts: deptsOver(snap.rows, range.current, range.previous),
    series: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, netCents: v.net, grossCents: v.gross })),
    pulledAt: snap.pulledAt,
  };
}

/** The most recent day the source has finished reporting. */
export async function lastCompleteDay(): Promise<string | null> {
  return (await load()).lastCompleteDay;
}

/** The partial day the source is still receiving — today. */
export async function partialDay(): Promise<string> {
  return (await load()).partialDay;
}

/** Every period at once, for the comparison table. */
export async function summariseAllPeriods(periods: readonly Period[]) {
  return Promise.all(periods.map((p) => summariseForPeriod(p).then((s) => ({ period: p, ...s }))));
}
