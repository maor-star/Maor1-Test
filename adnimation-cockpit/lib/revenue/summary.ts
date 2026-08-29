import type { RevenueFact } from './types';
import { ecpmCents, takeRate } from './normalize';
import { detectAnomalies, type Anomaly, type AnomalyInput } from './anomaly';
import { departmentLabel } from './departments';

/**
 * Cockpit strip 1 (spec §5) and the daily overview (7.3), computed from facts
 * so the page, the evening report and the tests all agree on one arithmetic.
 */

export type Basis = 'net' | 'gross';

export interface Delta {
  /** null when there is no comparable prior figure — render "—", never 0%. */
  pct: number | null;
  absCents: number | null;
}

export interface DeptSummary {
  /** The source's own demand category — see lib/revenue/departments.ts. */
  deptCode: string;
  label: string;
  /** Categories folded into this department, for the drill-down. */
  categories: { category: string; businessLine: string; netCents: number; grossCents: number }[];
  grossCents: number;
  netCents: number;
  impressions: number;
  ecpmCents: number | null;
  takeRate: number | null;
  vsPrevDay: Delta;
  vsSameDayLastWeek: Delta;
  vsSevenDayAvg: Delta;
  spark: number[];
}

export interface RevenueSummary {
  date: string;
  basis: Basis;
  totalGrossCents: number;
  totalNetCents: number;
  totalImpressions: number;
  ecpmCents: number | null;
  takeRate: number | null;
  vsPrevDay: Delta;
  vsSameDayLastWeek: Delta;
  vsSevenDayAvg: Delta;
  depts: DeptSummary[];
  spark: number[];
  anomalies: Anomaly[];
}

const key = (f: RevenueFact) => f.deptCode;

const amount = (f: RevenueFact, basis: Basis) => (basis === 'net' ? f.netCents : f.grossCents);

function delta(actual: number, prior: number | null): Delta {
  if (prior === null || prior === 0) return { pct: null, absCents: null };
  return { pct: (actual - prior) / prior, absCents: actual - prior };
}

const shiftDays = (isoDate: string, days: number): string =>
  new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** Sums one scope on one date; null when that date has no rows at all. */
function sumOn(
  facts: RevenueFact[],
  date: string,
  basis: Basis,
  scope?: (f: RevenueFact) => boolean,
): number | null {
  const rows = facts.filter((f) => f.date === date && (!scope || scope(f)));
  if (rows.length === 0) return null;
  return rows.reduce((acc, f) => acc + amount(f, basis), 0);
}

function sevenDayAverage(
  facts: RevenueFact[],
  date: string,
  basis: Basis,
  scope?: (f: RevenueFact) => boolean,
): number | null {
  const values: number[] = [];
  for (let i = 1; i <= 7; i += 1) {
    const v = sumOn(facts, shiftDays(date, -i), basis, scope);
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function sparkline(
  facts: RevenueFact[],
  date: string,
  basis: Basis,
  days: number,
  scope?: (f: RevenueFact) => boolean,
): number[] {
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(sumOn(facts, shiftDays(date, -i), basis, scope) ?? 0);
  }
  return out;
}

export function summariseRevenue(
  facts: RevenueFact[],
  date: string,
  basis: Basis = 'net',
  sparkDays = 30,
): RevenueSummary {
  const onDate = facts.filter((f) => f.date === date);

  const byDept = new Map<string, RevenueFact[]>();
  for (const f of onDate) {
    const k = key(f);
    byDept.set(k, [...(byDept.get(k) ?? []), f]);
  }

  const depts: DeptSummary[] = [...byDept.entries()]
    .map(([k, rows]) => {
      const deptCode = k;
      const scope = (f: RevenueFact) => key(f) === k;
      const grossCents = rows.reduce((a, f) => a + f.grossCents, 0);
      const netCents = rows.reduce((a, f) => a + f.netCents, 0);
      const impressions = rows.reduce((a, f) => a + f.impressions, 0);
      const actual = basis === 'net' ? netCents : grossCents;

      return {
        deptCode,
        label: departmentLabel(deptCode),
        categories: rows
          .map((f) => ({
            category: f.category,
            businessLine: f.businessLine,
            netCents: f.netCents,
            grossCents: f.grossCents,
          }))
          .sort((a, b) => b.netCents - a.netCents),
        grossCents,
        netCents,
        impressions,
        ecpmCents: ecpmCents(netCents, impressions),
        takeRate: takeRate(grossCents, netCents),
        vsPrevDay: delta(actual, sumOn(facts, shiftDays(date, -1), basis, scope)),
        vsSameDayLastWeek: delta(actual, sumOn(facts, shiftDays(date, -7), basis, scope)),
        vsSevenDayAvg: delta(actual, sevenDayAverage(facts, date, basis, scope)),
        spark: sparkline(facts, date, basis, sparkDays, scope),
      };
    })
    // Spec §5: departments sorted highest revenue first.
    .sort((a, b) => (basis === 'net' ? b.netCents - a.netCents : b.grossCents - a.grossCents));

  const totalGrossCents = onDate.reduce((a, f) => a + f.grossCents, 0);
  const totalNetCents = onDate.reduce((a, f) => a + f.netCents, 0);
  const totalImpressions = onDate.reduce((a, f) => a + f.impressions, 0);
  const totalActual = basis === 'net' ? totalNetCents : totalGrossCents;

  // Anomalies are always measured on net: gross moves with fees we do not keep.
  const anomalyInputs: AnomalyInput[] = depts.map((d) => ({
    scopeType: 'dept' as const,
    scopeId: d.deptCode,
    scopeLabel: d.label,
    history: buildHistory(facts, date, (f) => key(f) === d.deptCode),
    today: { date, netCents: d.netCents },
  }));
  anomalyInputs.push({
    scopeType: 'total',
    scopeId: 'total',
    scopeLabel: 'Company total',
    history: buildHistory(facts, date),
    today: { date, netCents: totalNetCents },
  });

  return {
    date,
    basis,
    totalGrossCents,
    totalNetCents,
    totalImpressions,
    ecpmCents: ecpmCents(totalNetCents, totalImpressions),
    takeRate: takeRate(totalGrossCents, totalNetCents),
    vsPrevDay: delta(totalActual, sumOn(facts, shiftDays(date, -1), basis)),
    vsSameDayLastWeek: delta(totalActual, sumOn(facts, shiftDays(date, -7), basis)),
    vsSevenDayAvg: delta(totalActual, sevenDayAverage(facts, date, basis)),
    depts,
    spark: sparkline(facts, date, basis, sparkDays),
    anomalies: detectAnomalies(anomalyInputs),
  };
}

/** Net-revenue history before `date`, oldest first — the anomaly baseline input. */
export function buildHistory(
  facts: RevenueFact[],
  date: string,
  scope?: (f: RevenueFact) => boolean,
): { date: string; netCents: number }[] {
  const byDate = new Map<string, number>();
  for (const f of facts) {
    if (f.date >= date) continue;
    if (scope && !scope(f)) continue;
    byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.netCents);
  }
  return [...byDate.entries()]
    .map(([d, netCents]) => ({ date: d, netCents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The latest date in the data that is not today — the cockpit's "yesterday". */
export function latestCompleteDate(facts: RevenueFact[], today: string): string | null {
  const dates = [...new Set(facts.map((f) => f.date))].filter((d) => d < today).sort();
  return dates.at(-1) ?? null;
}
