import { describe, expect, it } from 'vitest';
import {
  actualFor, attainment, daysInMonth, gapCents, judgedDays, monthOf, proRatedTarget, verdict,
} from '@/lib/control/target-rules';
import { notStartedYet } from '@/lib/control/lines';

const usd = (n: number) => n * 100;

describe('the month a target belongs to', () => {
  it('takes any day to the first of its month', () => {
    expect(monthOf('2026-09-17')).toBe('2026-09-01');
    expect(monthOf('2026-09-01')).toBe('2026-09-01');
  });

  it('knows how long a month is, February included', () => {
    expect(daysInMonth('2026-01-15')).toBe(31);
    expect(daysInMonth('2026-04-02')).toBe(30);
    expect(daysInMonth('2026-02-10')).toBe(28);
    expect(daysInMonth('2028-02-10')).toBe(29);
  });
});

describe('pro-rating a monthly target to the window on screen', () => {
  it('gives the whole target over a whole month', () => {
    expect(proRatedTarget(usd(30_000), 30, 30)).toBe(usd(30_000));
  });

  it('gives a week of it over a week', () => {
    // A month's target held against a week's revenue would fail every line
    // every Monday, which is how a colour stops meaning anything.
    expect(proRatedTarget(usd(30_000), 7, 30)).toBe(usd(7_000));
  });

  it('scales past a month for a quarter', () => {
    expect(proRatedTarget(usd(30_000), 90, 30)).toBe(usd(90_000));
  });

  it('is nothing when there is no target or no window', () => {
    expect(proRatedTarget(0, 30, 30)).toBe(0);
    expect(proRatedTarget(usd(1_000), 0, 30)).toBe(0);
    expect(proRatedTarget(-usd(5), 30, 30)).toBe(0);
  });
});

describe('the days a target is judged over', () => {
  it('is the days the source delivered, not the days on the calendar', () => {
    // Fourteen days of feed inside a thirty-day window is a hole in the
    // pipeline, not a line that missed half its month.
    expect(judgedDays(14, 30)).toBe(14);
  });

  it('is nothing at all when the source reported nothing', () => {
    expect(judgedDays(0, 30)).toBe(0);
    expect(verdict(0, null)).toBe('unset');
  });

  it('never judges a line on days it did not report', () => {
    const monthly = usd(30_000);
    const fair = proRatedTarget(monthly, judgedDays(14, 30), 30);
    const unfair = proRatedTarget(monthly, 30, 30);
    expect(fair).toBeLessThan(unfair);
    expect(verdict(usd(14_500), fair)).toBe('hit');
    expect(verdict(usd(14_500), unfair)).toBe('missed');
  });
});

describe('green or red', () => {
  it('is green at the target and above it', () => {
    expect(verdict(usd(7_000), usd(7_000))).toBe('hit');
    expect(verdict(usd(9_999), usd(7_000))).toBe('hit');
  });

  it('is red a dollar under', () => {
    expect(verdict(usd(6_999), usd(7_000))).toBe('missed');
  });

  it('is neither when nobody set a target', () => {
    // Red has to be a judgement. Judging a line against a number nobody set
    // is how a wall of tiles becomes a wall of red he stops reading.
    expect(verdict(usd(1), null)).toBe('unset');
    expect(verdict(usd(1), 0)).toBe('unset');
  });
});

describe('how far off it is', () => {
  it('says what share is in', () => {
    expect(attainment(usd(3_500), usd(7_000))).toBeCloseTo(0.5);
    expect(attainment(usd(3_500), null)).toBeNull();
  });

  it('says what is still to find, in money', () => {
    expect(gapCents(usd(5_000), usd(7_000))).toBe(-usd(2_000));
    expect(gapCents(usd(9_000), usd(7_000))).toBe(usd(2_000));
    expect(gapCents(usd(9_000), null)).toBeNull();
  });
});

describe('which figure a target is judged against', () => {
  it('uses gross for a gross target', () => {
    expect(actualFor('gross', { grossCents: usd(100), profitCents: usd(20) })).toBe(usd(100));
  });

  it('uses net for a net target', () => {
    expect(actualFor('net', { grossCents: usd(100), profitCents: usd(20) })).toBe(usd(20));
  });

  it('never invents a net for a line that reports none', () => {
    // Several lines report gross only. Judging one against a column of zeroes
    // fails it every day for ever, which is worse than not judging it.
    expect(actualFor('net', { grossCents: usd(100), profitCents: 0 })).toBe(0);
    expect(verdict(actualFor('gross', { grossCents: usd(100), profitCents: 0 }), usd(90))).toBe('hit');
  });
});

/**
 * A line that has not started against a line that has stopped.
 *
 * They look identical on a tile — a small number, or none — and they mean
 * opposite things. Exchange CTV took two dollars in the last week of August
 * and is meant to; Core Publishers taking two dollars would be an emergency.
 * Without this rule he reads the first as the second and goes looking for a
 * fault that is really a line he has not launched yet.
 */
describe('a line that has not started yet', () => {
  it('says so when it is taking almost nothing', () => {
    // The real figure: $2 across seven days on the exchange's CTV environment.
    expect(notStartedYet({ grossCents: 200, daysReported: 7 })).toBe(true);
  });

  it('does not say so about a line that is simply small', () => {
    // $170 a day is a small business, not an unlaunched one.
    expect(notStartedYet({ grossCents: 119_000, daysReported: 7 })).toBe(false);
  });

  it('judges the rate, not the total, so the window does not decide it', () => {
    // The same line over a quarter must read the same as over a week: $2 a
    // week is under a dollar a day however long you add it up for.
    expect(notStartedYet({ grossCents: 2_600, daysReported: 91 })).toBe(true);
    expect(notStartedYet({ grossCents: 29, daysReported: 1 })).toBe(true);
    // And a dollar a day is the line: $2 in a single day is over it.
    expect(notStartedYet({ grossCents: 200, daysReported: 1 })).toBe(false);
  });

  it('stays quiet when the window holds no days at all', () => {
    // Nothing reported is a different thing again — the tile already says
    // "nothing in this window", and calling that "not started" would be a
    // guess about a line that may be running perfectly well.
    expect(notStartedYet({ grossCents: 0, daysReported: 0 })).toBe(false);
  });
});
