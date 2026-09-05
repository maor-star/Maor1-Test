/**
 * A target, and whether a line is meeting it.
 *
 * No database and no clock underneath, because this is the arithmetic that
 * turns a tile green or red — and a tile that is the wrong colour is worse
 * than a tile with no colour on it at all.
 */

/** What the target is set against. Several lines report gross and no profit. */
export const TARGET_BASES = ['gross', 'net'] as const;
export type TargetBasis = (typeof TARGET_BASES)[number];

export const BASIS_LABEL: Record<TargetBasis, string> = {
  gross: 'GROSS',
  net: 'NET',
};

/** Where the number came from, so a figure he typed is never mistaken for a fed one. */
export const TARGET_SOURCES = ['manual', 'feed'] as const;
export type TargetSource = (typeof TARGET_SOURCES)[number];

export interface LineTarget {
  line: string;
  /** The first of the month it applies to, as YYYY-MM-01. */
  month: string;
  targetCents: number;
  basis: TargetBasis;
  source: TargetSource;
  updatedAt: Date | null;
}

/** Days in the month a YYYY-MM-DD date falls in. */
export function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The first of the month a date falls in. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * The share of a monthly target that the window he is looking at should have
 * earned.
 *
 * The period selector is not always a month — he reads the company over seven
 * days, a quarter, the year — and a month's target held up against a week's
 * revenue says every line is failing. So the target is pro-rated to the days
 * on screen: a 30-day month with a target of 300 expects 70 over seven days.
 *
 * Days beyond the month are counted at the same daily rate rather than
 * dropped, because a quarter is three months of roughly this size and the
 * alternative is a quarter that looks impossibly good.
 */
export function proRatedTarget(monthlyCents: number, days: number, monthLength = 30): number {
  if (monthlyCents <= 0 || days <= 0) return 0;
  const perDay = monthlyCents / Math.max(1, monthLength);
  return Math.round(perDay * days);
}

/**
 * The days a target is judged over.
 *
 * The days the source actually delivered, not the days on the calendar. A line
 * that reported fourteen of the thirty days on screen has not missed half its
 * month — the feed has a hole in it, and marking the line red for that teaches
 * him the colour means "the pipeline is late" rather than "this needs you".
 *
 * Nothing reported at all is not a miss either: it is nothing to judge.
 */
export function judgedDays(daysReported: number, windowDays: number): number {
  if (daysReported <= 0) return 0;
  return Math.min(daysReported, Math.max(windowDays, daysReported));
}

export type TargetVerdict = 'hit' | 'missed' | 'unset';

/**
 * Green or red, and nothing in between.
 *
 * He asked for exactly two states: meeting the target, or not. A third colour
 * for "nearly" is a colour he would have to stop and interpret, which is the
 * opposite of what a wall of tiles is for.
 */
export function verdict(actualCents: number, expectedCents: number | null): TargetVerdict {
  if (expectedCents === null || expectedCents <= 0) return 'unset';
  return actualCents >= expectedCents ? 'hit' : 'missed';
}

/** How much of the pro-rated target is in, as a fraction. Null with no target. */
export function attainment(actualCents: number, expectedCents: number | null): number | null {
  if (expectedCents === null || expectedCents <= 0) return null;
  return actualCents / expectedCents;
}

/** What is still to find, or what it is ahead by. Null with no target. */
export function gapCents(actualCents: number, expectedCents: number | null): number | null {
  if (expectedCents === null || expectedCents <= 0) return null;
  return actualCents - expectedCents;
}

/**
 * The figure a target is judged against.
 *
 * Gross for a line whose target was set on gross, net for one set on net —
 * and gross when a line reports no profit at all, because judging a line
 * against a column of zeroes fails it every day for ever.
 */
export function actualFor(
  basis: TargetBasis,
  figures: { grossCents: number; profitCents: number },
): number {
  if (basis === 'net' && figures.profitCents > 0) return figures.profitCents;
  if (basis === 'net') return 0;
  return figures.grossCents;
}
