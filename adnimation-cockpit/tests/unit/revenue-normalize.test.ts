import { describe, expect, it } from 'vitest';
import {
  ecpmCents, isPartialDay, looksSettled, takeRate, toRevenueFact, toRevenueFacts, totalsByDay,
} from '@/lib/revenue/normalize';
import type { ArsRow } from '@/lib/revenue/types';

const row = (over: Partial<ArsRow> = {}): ArsRow => ({
  date: '2026-08-28',
  category: 'google',
  trading: false,
  grossCents: 1_100_694,
  feeCents: 847_828,
  impressions: 13_085_486,
  ...over,
});

describe('toRevenueFact', () => {
  it('derives net as gross minus fee', () => {
    expect(toRevenueFact(row()).netCents).toBe(1_100_694 - 847_828);
  });

  /**
   * The reason net is derived rather than read: on 2026-08-26..28 the source
   * had not run its settlement pass, so its own total_revenue still equalled
   * publisher_revenue and overstated net roughly 2.7x. Deriving from gross and
   * fee gives the same answer on settled and unsettled days alike.
   */
  it('gives a consistent net on an unsettled day', () => {
    const settled = toRevenueFact(row({ date: '2026-08-25', grossCents: 1_307_110, feeCents: 1_010_782 }));
    const unsettled = toRevenueFact(row({ date: '2026-08-27', grossCents: 1_196_819, feeCents: 920_361 }));
    const ratio = (f: { netCents: number; grossCents: number }) => f.netCents / f.grossCents;
    // Both land in the same take-rate band; no overnight step change.
    expect(Math.abs(ratio(settled) - ratio(unsettled))).toBeLessThan(0.05);
  });

  it("uses the source's own category as the department", () => {
    const fact = toRevenueFact(row());
    expect(fact.deptCode).toBe('google');
    expect(fact.category).toBe('google');
    expect(fact.businessLine).toBe('publisher');
  });

  it('keeps the business line as a separate axis from the department', () => {
    const fact = toRevenueFact(row({ trading: true, category: 'header_bidding' }));
    expect(fact.deptCode).toBe('header_bidding');
    expect(fact.businessLine).toBe('trading');
  });

  it('gives a category the source has just added its own department', () => {
    const fact = toRevenueFact(row({ category: 'brand_new_channel' }));
    expect(fact.deptCode).toBe('brand_new_channel');
    expect(fact.netCents).toBe(1_100_694 - 847_828); // still counted in totals
  });

  it('handles a zero-fee row without dividing by zero', () => {
    const fact = toRevenueFact(row({ feeCents: 0 }));
    expect(fact.netCents).toBe(fact.grossCents);
  });
});

describe('totalsByDay', () => {
  it('sums categories per day and sorts chronologically', () => {
    const facts = toRevenueFacts(
      [
        row({ date: '2026-08-28', grossCents: 100, feeCents: 40, impressions: 10 }),
        row({ date: '2026-08-27', grossCents: 200, feeCents: 50, impressions: 20 }),
        row({ date: '2026-08-28', category: 'video', grossCents: 300, feeCents: 100, impressions: 30 }),
      ],
    );
    const totals = totalsByDay(facts);
    expect(totals.map((t) => t.date)).toEqual(['2026-08-27', '2026-08-28']);
    expect(totals[1]).toMatchObject({ grossCents: 400, netCents: 260, impressions: 40 });
  });

  it('returns nothing for no facts', () => {
    expect(totalsByDay([])).toEqual([]);
  });
});

describe('isPartialDay', () => {
  it('treats today and anything later as partial', () => {
    expect(isPartialDay('2026-08-29', '2026-08-29')).toBe(true);
    expect(isPartialDay('2026-08-30', '2026-08-29')).toBe(true);
  });

  it('treats yesterday as complete', () => {
    expect(isPartialDay('2026-08-28', '2026-08-29')).toBe(false);
  });
});

describe('looksSettled', () => {
  it('needs both a fee and gross to call a row settled', () => {
    expect(looksSettled({ grossCents: 100, feeCents: 40 })).toBe(true);
    expect(looksSettled({ grossCents: 100, feeCents: 0 })).toBe(false);
    expect(looksSettled({ grossCents: 0, feeCents: 0 })).toBe(false);
  });
});

describe('derived metrics', () => {
  it('computes eCPM per thousand impressions', () => {
    expect(ecpmCents(100_000, 1_000_000)).toBe(100);
  });

  it('returns null eCPM rather than infinity on zero impressions', () => {
    expect(ecpmCents(100, 0)).toBeNull();
  });

  it('computes take rate and guards zero gross', () => {
    expect(takeRate(1000, 250)).toBe(0.25);
    expect(takeRate(0, 0)).toBeNull();
  });
});
