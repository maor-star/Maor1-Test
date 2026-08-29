/**
 * Time windows for the revenue module (spec 7.3: yesterday, 7 days, 30 days,
 * MTD, QTD, YTD) plus the comparison period each one is judged against.
 *
 * Every window ends on the last *complete* day — today is always partial, and
 * a half day compared against a full one reads as a collapse.
 *
 * All arithmetic is on YYYY-MM-DD strings in UTC. The source reports by
 * calendar date, so shifting into a timezone would move revenue between days.
 */

export const PERIODS = ['1D', '7D', '30D', 'MTD', 'QTD', 'YTD'] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  '1D': 'YESTERDAY',
  '7D': '7 DAYS',
  '30D': '30 DAYS',
  MTD: 'MONTH TO DATE',
  QTD: 'QUARTER TO DATE',
  YTD: 'YEAR TO DATE',
};

/** What each window is compared against, for the delta shown beside it. */
export const COMPARISON_LABEL: Record<Period, string> = {
  '1D': 'vs same day last week',
  '7D': 'vs previous 7 days',
  '30D': 'vs previous 30 days',
  MTD: 'vs same days last month',
  QTD: 'vs same days last quarter',
  YTD: 'vs same days last year',
};

export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodRange {
  period: Period;
  current: DateRange;
  /** The equivalent earlier window. Same number of days, so the two compare fairly. */
  previous: DateRange;
  days: number;
}

const parse = (d: string): Date => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string =>
  fmt(new Date(parse(d).getTime() + n * 86_400_000));

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

const startOfMonth = (d: string): string => `${d.slice(0, 7)}-01`;

function startOfQuarter(d: string): string {
  const date = parse(d);
  const q = Math.floor(date.getUTCMonth() / 3);
  return `${date.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`;
}

const startOfYear = (d: string): string => `${d.slice(0, 4)}-01-01`;

/** Shifts a date back whole months, clamping to the last valid day. */
function shiftMonths(d: string, months: number): string {
  const date = parse(d);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return fmt(target);
}

/**
 * Builds the current and comparison ranges for a period, anchored on the last
 * complete day.
 *
 * The to-date windows compare against the *same number of elapsed days* in the
 * earlier period, not the whole of it: on the 5th of the month, MTD covers five
 * days, so comparing it against a full previous month would always look like a
 * collapse.
 */
export function rangeFor(period: Period, lastCompleteDay: string): PeriodRange {
  const to = lastCompleteDay;

  const build = (from: string, prevFrom: string, prevTo: string): PeriodRange => ({
    period,
    current: { from, to },
    previous: { from: prevFrom, to: prevTo },
    days: daysBetween(from, to),
  });

  switch (period) {
    case '1D':
      // A single day compares against the same weekday, not the day before:
      // weekend traffic is structurally different.
      return build(to, addDays(to, -7), addDays(to, -7));

    case '7D':
      return build(addDays(to, -6), addDays(to, -13), addDays(to, -7));

    case '30D':
      return build(addDays(to, -29), addDays(to, -59), addDays(to, -30));

    case 'MTD': {
      const from = startOfMonth(to);
      const elapsed = daysBetween(from, to);
      const prevFrom = shiftMonths(from, 1);
      return build(from, prevFrom, addDays(prevFrom, elapsed - 1));
    }

    case 'QTD': {
      const from = startOfQuarter(to);
      const elapsed = daysBetween(from, to);
      const prevFrom = shiftMonths(from, 3);
      return build(from, prevFrom, addDays(prevFrom, elapsed - 1));
    }

    case 'YTD': {
      const from = startOfYear(to);
      const elapsed = daysBetween(from, to);
      const prevFrom = shiftMonths(from, 12);
      return build(from, prevFrom, addDays(prevFrom, elapsed - 1));
    }
  }
}

export function isPeriod(value: string | undefined): value is Period {
  return PERIODS.includes(value as Period);
}
