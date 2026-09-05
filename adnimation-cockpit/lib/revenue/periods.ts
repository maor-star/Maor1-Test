/**
 * Time windows for the revenue module, and the comparison each is judged
 * against: today, yesterday, 7 days, 30 days, month to date, quarter to date,
 * the last complete quarter, and year to date.
 *
 * TODAY is the one window that is deliberately incomplete. Revenue settles for
 * hours after a day ends, so today's figure is always a fraction of what it
 * will be. It is included because the CEO asked for it, and it is always
 * labelled partial — every other window ends on the last complete day.
 *
 * All arithmetic is on YYYY-MM-DD strings in UTC. The source reports by
 * calendar date, so shifting into a timezone would move revenue between days.
 */

export const PERIODS = [
  'TODAY', 'YESTERDAY', '7D', '30D', 'MTD', 'LAST_M', 'QTD', 'LAST_Q', 'YTD',
] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  TODAY: 'TODAY',
  YESTERDAY: 'YESTERDAY',
  '7D': '7 DAYS',
  '30D': '30 DAYS',
  MTD: 'MONTH TO DATE',
  QTD: 'QUARTER TO DATE',
  LAST_M: 'LAST MONTH',
  LAST_Q: 'LAST QUARTER',
  YTD: 'YEAR TO DATE',
};

/** Short label for the period switcher, where space is tight. */
export const PERIOD_TAB: Record<Period, string> = {
  TODAY: 'TODAY',
  YESTERDAY: 'YDAY',
  '7D': '7D',
  '30D': '30D',
  MTD: 'MTD',
  QTD: 'QTD',
  LAST_M: 'LAST MONTH',
  LAST_Q: 'LAST Q',
  YTD: 'YTD',
};

/** What each window is compared against, for the delta shown beside it. */
export const COMPARISON_LABEL: Record<Period, string> = {
  TODAY: 'vs the same weekday last week, at full day',
  YESTERDAY: 'vs same day last week',
  '7D': 'vs previous 7 days',
  '30D': 'vs previous 30 days',
  MTD: 'vs same days last month',
  QTD: 'vs same days last quarter',
  LAST_M: 'vs the month before it',
  LAST_Q: 'vs the quarter before it',
  YTD: 'vs same days last year',
};

/** The only window that includes a day the source has not finished reporting. */
export const PARTIAL_PERIODS: Period[] = ['TODAY'];

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
  /** True when the window ends on a day the source is still receiving data for. */
  partial: boolean;
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

/** The last day of the month a date falls in. */
function endOfMonth(d: string): string {
  const date = parse(d);
  return fmt(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/**
 * Builds the current and comparison ranges for a period.
 *
 * Everything is anchored on `lastCompleteDay` except TODAY, which is anchored
 * on `today` — the partial day the source is still receiving.
 *
 * The to-date windows compare against the *same number of elapsed days* in the
 * earlier period, not the whole of it: on the 5th of the month, MTD covers five
 * days, so comparing it against a full previous month would always look like a
 * collapse.
 */
export function rangeFor(
  period: Period,
  lastCompleteDay: string,
  today: string = addDays(lastCompleteDay, 1),
): PeriodRange {
  const to = lastCompleteDay;

  const build = (
    from: string,
    prevFrom: string,
    prevTo: string,
    over = to,
    partial = false,
  ): PeriodRange => ({
    period,
    current: { from, to: over },
    previous: { from: prevFrom, to: prevTo },
    days: daysBetween(from, over),
    partial,
  });

  switch (period) {
    case 'TODAY':
      // Compared against the same weekday, and marked partial: today's figure
      // is a few hours of a day measured against a whole one.
      return build(today, addDays(today, -7), addDays(today, -7), today, true);

    case 'YESTERDAY':
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

    /*
     * The last *complete* month — a whole month against a whole month, so
     * unlike month-to-date this needs no elapsed-days adjustment. It is the
     * window he closes a month on: "what did we actually do in August".
     */
    case 'LAST_M': {
      const thisMonthStart = startOfMonth(to);
      const from = shiftMonths(thisMonthStart, 1);
      const over = addDays(thisMonthStart, -1);
      const prevFrom = shiftMonths(from, 1);
      return build(from, prevFrom, addDays(from, -1), over);
    }

    case 'QTD': {
      const from = startOfQuarter(to);
      const elapsed = daysBetween(from, to);
      const prevFrom = shiftMonths(from, 3);
      return build(from, prevFrom, addDays(prevFrom, elapsed - 1));
    }

    case 'LAST_Q': {
      // The last *complete* quarter — a whole quarter against a whole quarter,
      // so this one needs no elapsed-days adjustment.
      const currentQuarterStart = startOfQuarter(to);
      const from = shiftMonths(currentQuarterStart, 3);
      const over = endOfMonth(addDays(currentQuarterStart, -1));
      const prevFrom = shiftMonths(from, 3);
      return build(from, prevFrom, endOfMonth(addDays(from, -1)), over);
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
