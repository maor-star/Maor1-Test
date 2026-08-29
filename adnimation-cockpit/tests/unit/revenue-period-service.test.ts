import { describe, expect, it } from 'vitest';
import {
  lastCompleteDay, partialDay, summariseAllPeriods, summariseForPeriod,
} from '@/lib/revenue/period-service';
import { PERIODS, type Period } from '@/lib/revenue/periods';
import { REVENUE_DEPARTMENTS } from '@/lib/revenue/departments';

/**
 * These run against the real year-to-date pull, so they check both the
 * arithmetic and that the fixture still holds together.
 */

describe('the source snapshot', () => {
  it('separates the day still being received from the last complete one', async () => {
    const [complete, today] = await Promise.all([lastCompleteDay(), partialDay()]);
    expect(complete).not.toBeNull();
    expect(complete! < today).toBe(true);
  });
});

describe('summariseForPeriod', () => {
  it('answers every window without gaps', async () => {
    for (const p of PERIODS) {
      const s = await summariseForPeriod(p);
      expect(s.current.days).toBeGreaterThan(0);
      expect(s.current.netCents).toBeGreaterThan(0);
      expect(s.current.netCents).toBeLessThanOrEqual(s.current.grossCents);
    }
  });

  it('only marks today partial', async () => {
    const all = await summariseAllPeriods(PERIODS);
    expect(all.filter((s) => s.range.partial).map((s) => s.period)).toEqual(['TODAY']);
  });

  it('shows today as a fraction of a full day, which is why it is labelled', async () => {
    const today = await summariseForPeriod('TODAY');
    const yesterday = await summariseForPeriod('YESTERDAY');
    expect(today.range.partial).toBe(true);
    expect(today.current.netCents).toBeLessThan(yesterday.current.netCents);
  });

  it('nests the windows: a day inside 7 days inside 30', async () => {
    const [d1, d7, d30] = await Promise.all([
      summariseForPeriod('YESTERDAY'),
      summariseForPeriod('7D'),
      summariseForPeriod('30D'),
    ]);
    expect(d1.current.netCents).toBeLessThan(d7.current.netCents);
    expect(d7.current.netCents).toBeLessThan(d30.current.netCents);
    expect(d1.current.days).toBe(1);
    expect(d7.current.days).toBe(7);
    expect(d30.current.days).toBe(30);
  });

  it('makes YTD the largest window and QTD a part of it', async () => {
    const [ytd, qtd] = await Promise.all([summariseForPeriod('YTD'), summariseForPeriod('QTD')]);
    expect(qtd.current.netCents).toBeLessThan(ytd.current.netCents);
    expect(ytd.range.current.from).toBe('2026-01-01');
  });

  it('reads the last complete quarter as three whole months', async () => {
    const q = await summariseForPeriod('LAST_Q');
    expect(q.range.current).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(q.current.days).toBe(91);
  });

  it("splits every window by the source's own departments", async () => {
    for (const p of PERIODS) {
      const s = await summariseForPeriod(p);
      for (const d of s.depts) {
        expect(REVENUE_DEPARTMENTS).toContain(d.deptCode);
        expect(d.label).toBeTruthy();
      }
    }
  });

  it('has department net summing exactly to the window total', async () => {
    for (const p of PERIODS) {
      const s = await summariseForPeriod(p);
      expect(s.depts.reduce((a, d) => a + d.netCents, 0)).toBe(s.current.netCents);
      expect(s.depts.reduce((a, d) => a + d.grossCents, 0)).toBe(s.current.grossCents);
    }
  });

  it('has department shares summing to one', async () => {
    const s = await summariseForPeriod('30D');
    expect(s.depts.reduce((a, d) => a + d.share, 0)).toBeCloseTo(1, 6);
  });

  it('orders departments by net, largest first', async () => {
    const nets = (await summariseForPeriod('YTD')).depts.map((d) => d.netCents);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
  });

  it('gives each department its own comparison against the same earlier window', async () => {
    const s = await summariseForPeriod('30D');
    for (const d of s.depts) {
      if (d.previousNetCents > 0) {
        expect(d.deltaPct).toBeCloseTo((d.netCents - d.previousNetCents) / d.previousNetCents, 9);
      } else {
        expect(d.deltaPct).toBeNull();
      }
    }
  });

  it('returns one series point per day in the window', async () => {
    const s = await summariseForPeriod('30D');
    expect(s.series).toHaveLength(30);
    expect(s.series[0]?.date).toBe(s.range.current.from);
    expect(s.series.at(-1)?.date).toBe(s.range.current.to);
    for (const point of s.series) expect(point.netCents).toBeLessThanOrEqual(point.grossCents);
  });

  it('compares each window against a real earlier window, not an empty one', async () => {
    // YTD is the exception: the pull starts on 1 January, so last year has no
    // rows. That must read as "no comparable period", never as a fall to zero.
    for (const p of PERIODS.filter((x): x is Period => x !== 'YTD')) {
      const s = await summariseForPeriod(p);
      expect(s.previous.days).toBeGreaterThan(0);
    }
    expect((await summariseForPeriod('YTD')).previous.days).toBe(0);
    expect((await summariseForPeriod('YTD')).deltaPct).toBeNull();
  });
});
