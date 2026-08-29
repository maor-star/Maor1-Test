import { describe, expect, it } from 'vitest';
import {
  COMPARISON_LABEL, PARTIAL_PERIODS, PERIODS, PERIOD_LABEL, PERIOD_TAB, addDays, daysBetween,
  isPeriod, rangeFor,
} from '@/lib/revenue/periods';

// 2026-08-28 is a Friday, in Q3, in August. 2026-08-29 is the partial day.
const DAY = '2026-08-28';
const TODAY = '2026-08-29';

describe('date helpers', () => {
  it('adds and subtracts days across month boundaries', () => {
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-08-28', '2026-08-28')).toBe(1);
    expect(daysBetween('2026-08-22', '2026-08-28')).toBe(7);
  });
});

describe('rangeFor', () => {
  it('makes yesterday a single day compared with the same weekday', () => {
    const r = rangeFor('YESTERDAY', DAY, TODAY);
    expect(r.current).toEqual({ from: DAY, to: DAY });
    expect(r.previous).toEqual({ from: '2026-08-21', to: '2026-08-21' });
    expect(r.days).toBe(1);
    expect(r.partial).toBe(false);
  });

  it('gives today its own window, flagged partial', () => {
    const r = rangeFor('TODAY', DAY, TODAY);
    expect(r.current).toEqual({ from: TODAY, to: TODAY });
    expect(r.previous).toEqual({ from: '2026-08-22', to: '2026-08-22' });
    expect(r.partial).toBe(true);
  });

  it('is the only partial window — no other window includes an unfinished day', () => {
    for (const p of PERIODS) {
      const r = rangeFor(p, DAY, TODAY);
      expect(r.partial).toBe(PARTIAL_PERIODS.includes(p));
      if (!r.partial) expect(r.current.to <= DAY).toBe(true);
    }
  });

  it('defaults today to the day after the last complete one', () => {
    expect(rangeFor('TODAY', DAY).current.from).toBe(TODAY);
  });

  it('builds a 7-day window against the 7 days before it', () => {
    const r = rangeFor('7D', DAY);
    expect(r.current).toEqual({ from: '2026-08-22', to: '2026-08-28' });
    expect(r.previous).toEqual({ from: '2026-08-15', to: '2026-08-21' });
    expect(r.days).toBe(7);
  });

  it('builds a 30-day window against the 30 before it', () => {
    const r = rangeFor('30D', DAY);
    expect(r.current).toEqual({ from: '2026-07-30', to: '2026-08-28' });
    expect(r.previous).toEqual({ from: '2026-06-30', to: '2026-07-29' });
    expect(r.days).toBe(30);
  });

  it('starts MTD at the first of the month', () => {
    const r = rangeFor('MTD', DAY);
    expect(r.current).toEqual({ from: '2026-08-01', to: '2026-08-28' });
  });

  /**
   * The comparison must cover the same number of elapsed days. Comparing 28
   * days of August against all 31 of July would report a fall every month.
   */
  it('compares MTD against the same elapsed days of the previous month', () => {
    const r = rangeFor('MTD', DAY);
    expect(r.previous).toEqual({ from: '2026-07-01', to: '2026-07-28' });
    expect(daysBetween(r.previous.from, r.previous.to)).toBe(r.days);
  });

  it('starts QTD at the first day of the calendar quarter', () => {
    expect(rangeFor('QTD', DAY).current.from).toBe('2026-07-01');
    expect(rangeFor('QTD', '2026-02-10').current.from).toBe('2026-01-01');
    expect(rangeFor('QTD', '2026-05-10').current.from).toBe('2026-04-01');
    expect(rangeFor('QTD', '2026-11-10').current.from).toBe('2026-10-01');
  });

  it('compares QTD against the same elapsed days of the previous quarter', () => {
    const r = rangeFor('QTD', DAY);
    expect(r.previous.from).toBe('2026-04-01');
    expect(daysBetween(r.previous.from, r.previous.to)).toBe(r.days);
  });

  it('starts YTD on 1 January and compares with last year to date', () => {
    const r = rangeFor('YTD', DAY);
    expect(r.current).toEqual({ from: '2026-01-01', to: '2026-08-28' });
    expect(r.previous.from).toBe('2025-01-01');
    expect(daysBetween(r.previous.from, r.previous.to)).toBe(r.days);
  });

  it('covers the last complete calendar quarter, whole against whole', () => {
    const r = rangeFor('LAST_Q', DAY, TODAY);
    expect(r.current).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(r.previous).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(r.days).toBe(91);
  });

  it('rolls the last quarter back across a year boundary', () => {
    const r = rangeFor('LAST_Q', '2026-02-10', '2026-02-11');
    expect(r.current).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(r.previous).toEqual({ from: '2025-07-01', to: '2025-09-30' });
  });

  it('every period compares like with like', () => {
    for (const p of PERIODS) {
      const r = rangeFor(p, DAY, TODAY);
      // LAST_Q compares whole calendar quarters, and those genuinely differ in
      // length (Q1 2026 is 90 days, Q2 is 91). The headline delta divides by
      // days, so the comparison stays fair without forcing equal windows.
      if (p === 'LAST_Q') {
        expect(r.previous.from.endsWith('-01-01')).toBe(true);
        expect(r.previous.to.endsWith('-03-31')).toBe(true);
      } else {
        expect(daysBetween(r.previous.from, r.previous.to)).toBe(r.days);
      }
      expect(r.previous.to < r.current.from).toBe(true);
    }
  });

  it('never lets a window run past the day the source has reached', () => {
    for (const p of PERIODS) {
      const r = rangeFor(p, DAY, TODAY);
      expect(r.current.to <= TODAY).toBe(true);
      expect(r.current.from <= r.current.to).toBe(true);
    }
  });

  it('ends the to-date windows on the last complete day', () => {
    for (const p of ['YESTERDAY', '7D', '30D', 'MTD', 'QTD', 'YTD'] as const) {
      expect(rangeFor(p, DAY, TODAY).current.to).toBe(DAY);
    }
  });

  it('handles the 31st of a month rolling back into a shorter month', () => {
    // 31 March back one month is 28 February in a non-leap year, not 31 February.
    const r = rangeFor('MTD', '2026-03-31', '2026-04-01');
    expect(r.current.from).toBe('2026-03-01');
    expect(r.previous.from).toBe('2026-02-01');
    expect(daysBetween(r.previous.from, r.previous.to)).toBe(31);
  });

  it('handles the first day of a month, where MTD is one day', () => {
    const r = rangeFor('MTD', '2026-08-01', '2026-08-02');
    expect(r.days).toBe(1);
    expect(r.previous).toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });
});

describe('period metadata', () => {
  it('labels and comparisons exist for every period', () => {
    for (const p of PERIODS) {
      expect(PERIOD_LABEL[p]).toBeTruthy();
      expect(PERIOD_TAB[p]).toBeTruthy();
      expect(COMPARISON_LABEL[p]).toBeTruthy();
    }
  });

  it('validates a period string from the URL', () => {
    expect(isPeriod('30D')).toBe(true);
    expect(isPeriod('YTD')).toBe(true);
    expect(isPeriod('TODAY')).toBe(true);
    expect(isPeriod('LAST_Q')).toBe(true);
    expect(isPeriod('1D')).toBe(false);
    expect(isPeriod('nonsense')).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});
