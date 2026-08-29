import type { ArsRow, BusinessLine, RevenueFact } from './types';
import { departmentFor } from './departments';

/**
 * Turning source rows into revenue facts.
 *
 * DECISION — net is computed as `gross - fee`, never read from the source's
 * own `total_revenue` column.
 *
 * The source computes `total_revenue` in a settlement pass that runs a day or
 * two behind the raw numbers. Until it runs, `total_revenue` is left equal to
 * `publisher_revenue`, i.e. fees are not deducted yet. On the data pulled
 * 2026-08-29 that made the three most recent days look like this:
 *
 *   date         gross    fee    total_revenue   gross - fee
 *   2026-08-25  27,785  16,728          11,057         11,057   settled
 *   2026-08-26  25,363  15,810          24,390          9,553   NOT settled
 *   2026-08-27  26,281  16,669          25,398          9,612   NOT settled
 *   2026-08-28  24,021  15,320          23,172          8,701   NOT settled
 *
 * Reading `total_revenue` directly would have shown the CEO a ~170% overnight
 * jump in net revenue that never happened — and the anomaly detector would
 * have fired a spike alert on an artefact of the upstream job schedule.
 * `gross` and `fee` are both populated from the start, so deriving net keeps
 * the series consistent on every day, settled or not.
 */
export function toRevenueFact(row: ArsRow): RevenueFact {
  const businessLine: BusinessLine = row.trading ? 'trading' : 'publisher';
  return {
    date: row.date,
    // The department is the source's own category — no translation, so nothing
    // to confirm and nothing to get wrong. See lib/revenue/departments.ts.
    deptCode: departmentFor(row.category),
    category: row.category,
    businessLine,
    grossCents: row.grossCents,
    feeCents: row.feeCents,
    netCents: row.grossCents - row.feeCents,
    impressions: row.impressions,
  };
}

export function toRevenueFacts(rows: ArsRow[]): RevenueFact[] {
  return rows.map(toRevenueFact);
}

/**
 * A day is only comparable once the source has stopped adding to it. Today is
 * always partial; the cockpit's "yesterday" figure must skip it rather than
 * report a half-day as a collapse.
 */
export function isPartialDay(date: string, today: string): boolean {
  return date >= today;
}

/**
 * Independent settlement check, used to label figures in the UI rather than to
 * change them: our net is derived, so it is correct either way, but a day the
 * source has not settled can still gain late rows.
 */
export function looksSettled(row: { grossCents: number; feeCents: number }): boolean {
  return row.feeCents > 0 && row.grossCents > 0;
}

export interface DailyTotals {
  date: string;
  grossCents: number;
  netCents: number;
  impressions: number;
}

export function totalsByDay(facts: RevenueFact[]): DailyTotals[] {
  const byDate = new Map<string, DailyTotals>();
  for (const f of facts) {
    const row = byDate.get(f.date) ?? {
      date: f.date, grossCents: 0, netCents: 0, impressions: 0,
    };
    row.grossCents += f.grossCents;
    row.netCents += f.netCents;
    row.impressions += f.impressions;
    byDate.set(f.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** eCPM in cents, from net revenue — the figure the cockpit shows. */
export function ecpmCents(netCents: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Math.round((netCents / impressions) * 1000);
}

/** Take rate: the share of gross that survives demand fees. */
export function takeRate(grossCents: number, netCents: number): number | null {
  if (grossCents <= 0) return null;
  return netCents / grossCents;
}
