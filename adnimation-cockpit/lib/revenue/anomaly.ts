/**
 * Revenue anomaly detection — spec 7.4.
 *
 * For every scope (department / partner / site / format) a rolling 28-day
 * baseline is kept, adjusted for day of week. An anomaly is:
 *
 *   drop  > 20%  vs the 7-day median  → warning
 *   drop  > 35%, or zero on a day that was active → critical
 *   spike > 60%                        → watch (possible fraud, IVT, misreport)
 *
 * The day-of-week adjustment matters: weekend traffic is structurally lower,
 * and a plain 7-day median would fire a warning every Saturday.
 */

export const BASELINE_WINDOW_DAYS = 28;
export const DROP_WARNING_PCT = 0.2;
export const DROP_CRITICAL_PCT = 0.35;
export const SPIKE_WATCH_PCT = 0.6;
/** Below this the swings are noise, not news. */
export const MIN_MATERIAL_CENTS = 5_000;

export type AnomalySeverity = 'critical' | 'warning' | 'watch';
export type AnomalyKind = 'drop' | 'spike' | 'zeroed';

export interface RevenuePoint {
  date: string;
  netCents: number;
}

export interface AnomalyInput {
  scopeType: 'dept' | 'partner' | 'property' | 'format' | 'total';
  scopeId: string;
  scopeLabel: string;
  /** History, oldest first, excluding the day under test. */
  history: RevenuePoint[];
  today: RevenuePoint;
}

export interface Anomaly {
  scopeType: AnomalyInput['scopeType'];
  scopeId: string;
  scopeLabel: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  date: string;
  actualCents: number;
  baselineCents: number;
  deltaPct: number;
  moneyImpactCents: number;
  whatHappened: string;
  recommendedAction: string;
}

const dayOfWeek = (isoDate: string): number => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/**
 * Baseline for a date: the median of the same weekday within the trailing
 * 28-day window. Falls back to the plain 7-day median when there are fewer
 * than two same-weekday samples — early in a series, a same-weekday median of
 * one point is just that point.
 */
export function baselineFor(history: RevenuePoint[], date: string): number {
  const window = history.slice(-BASELINE_WINDOW_DAYS);
  const dow = dayOfWeek(date);
  const sameDow = window.filter((p) => dayOfWeek(p.date) === dow).map((p) => p.netCents);
  if (sameDow.length >= 2) return median(sameDow);
  return median(window.slice(-7).map((p) => p.netCents));
}

export function detectAnomaly(input: AnomalyInput): Anomaly | null {
  const baselineCents = baselineFor(input.history, input.today.date);
  if (baselineCents <= 0) return null;

  const actualCents = input.today.netCents;
  const deltaPct = (actualCents - baselineCents) / baselineCents;
  const moneyImpactCents = Math.abs(actualCents - baselineCents);

  // Ignore scopes too small to matter, however large the percentage swing.
  if (baselineCents < MIN_MATERIAL_CENTS && moneyImpactCents < MIN_MATERIAL_CENTS) return null;

  const base = {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    scopeLabel: input.scopeLabel,
    date: input.today.date,
    actualCents,
    baselineCents,
    deltaPct,
    moneyImpactCents,
  };

  const pct = (n: number) => `${Math.abs(Math.round(n * 100))}%`;

  // Zero on a day the scope was previously active is its own case: a broken
  // integration, not a soft decline.
  if (actualCents === 0) {
    return {
      ...base,
      kind: 'zeroed',
      severity: 'critical',
      whatHappened: `${input.scopeLabel}: zero revenue on a day that was active (comparable baseline $${(baselineCents / 100).toLocaleString('en-US')}).`,
      recommendedAction: 'Check the integration and upstream reporting immediately.',
    };
  }

  if (deltaPct <= -DROP_CRITICAL_PCT) {
    return {
      ...base,
      kind: 'drop',
      severity: 'critical',
      whatHappened: `${input.scopeLabel}: down ${pct(deltaPct)} against the same weekday over the last 28 days.`,
      recommendedAction: 'Check demand, tag health and reporting with the largest partners.',
    };
  }

  if (deltaPct <= -DROP_WARNING_PCT) {
    return {
      ...base,
      kind: 'drop',
      severity: 'warning',
      whatHappened: `${input.scopeLabel}: down ${pct(deltaPct)} against baseline.`,
      recommendedAction: 'Watch today; if it holds tomorrow, open an investigation with the department.',
    };
  }

  if (deltaPct >= SPIKE_WATCH_PCT) {
    return {
      ...base,
      kind: 'spike',
      severity: 'watch',
      whatHappened: `${input.scopeLabel}: up ${pct(deltaPct)} against baseline.`,
      recommendedAction: 'Confirm this is not IVT, spoofed traffic or a reporting error before counting it.',
    };
  }

  return null;
}

/** Runs the detector across many scopes and returns the worst first. */
export function detectAnomalies(inputs: AnomalyInput[]): Anomaly[] {
  const order: Record<AnomalySeverity, number> = { critical: 0, warning: 1, watch: 2 };
  return inputs
    .map(detectAnomaly)
    .filter((a): a is Anomaly => a !== null)
    .sort(
      (a, b) => order[a.severity] - order[b.severity] || b.moneyImpactCents - a.moneyImpactCents,
    );
}
