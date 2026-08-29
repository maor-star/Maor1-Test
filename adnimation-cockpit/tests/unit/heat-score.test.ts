import { describe, expect, it } from 'vitest';
import {
  BLOCKED_SATURATION_PEOPLE, HEAT_WEIGHTS, MONEY_SATURATION_CENTS,
  OVERDUE_SATURATION_DAYS, daysOverdue, heatBand, heatBreakdown, heatScore,
} from '@/lib/scoring/heat-score';

const NOW = new Date('2026-08-29T09:00:00Z');

const base = {
  priority: 'P3' as const,
  dueDate: null,
  moneyImpactCents: null,
  blockedPeopleCount: 0,
  isSoleOwner: false,
  now: NOW,
};

describe('daysOverdue', () => {
  it('is zero without a due date', () => {
    expect(daysOverdue(null, NOW)).toBe(0);
  });

  it('is zero for a future due date', () => {
    expect(daysOverdue('2026-09-05', NOW)).toBe(0);
  });

  it('is zero on the due date itself', () => {
    expect(daysOverdue('2026-08-29', NOW)).toBe(0);
  });

  it('counts calendar days past the due date', () => {
    expect(daysOverdue('2026-08-22', NOW)).toBe(7);
  });

  it('ignores an unparseable date rather than throwing', () => {
    expect(daysOverdue('not-a-date', NOW)).toBe(0);
  });
});

describe('heatScore', () => {
  it('scores a cold P3 with nothing attached near zero', () => {
    expect(heatScore(base)).toBe(4); // 0.1 × 40
  });

  it('gives a P0 the full priority weight', () => {
    const { terms } = heatBreakdown({ ...base, priority: 'P0' });
    expect(terms.priority).toBe(HEAT_WEIGHTS.priority);
  });

  it('ranks priorities monotonically, all else equal', () => {
    const at = (priority: 'P0' | 'P1' | 'P2' | 'P3') => heatScore({ ...base, priority });
    expect(at('P0')).toBeGreaterThan(at('P1'));
    expect(at('P1')).toBeGreaterThan(at('P2'));
    expect(at('P2')).toBeGreaterThan(at('P3'));
  });

  it('saturates the overdue term at the cap instead of growing without bound', () => {
    const atCap = heatScore({ ...base, dueDate: '2026-08-15' }); // 14 days
    const wayPast = heatScore({ ...base, dueDate: '2025-01-01' });
    expect(atCap).toBe(wayPast);
  });

  it('scales the overdue term linearly up to the cap', () => {
    const half = heatBreakdown({ ...base, dueDate: '2026-08-22' }); // 7 of 14 days
    expect(half.terms.overdue).toBeCloseTo(HEAT_WEIGHTS.overdue / 2, 6);
  });

  it('saturates the money term at the cap', () => {
    const atCap = heatBreakdown({ ...base, moneyImpactCents: MONEY_SATURATION_CENTS });
    const over = heatBreakdown({ ...base, moneyImpactCents: MONEY_SATURATION_CENTS * 10 });
    expect(atCap.terms.money).toBe(HEAT_WEIGHTS.money);
    expect(over.terms.money).toBe(HEAT_WEIGHTS.money);
  });

  it('saturates the blocked-people term at the cap', () => {
    const over = heatBreakdown({ ...base, blockedPeopleCount: BLOCKED_SATURATION_PEOPLE * 3 });
    expect(over.terms.blocked).toBe(HEAT_WEIGHTS.blocked);
  });

  it('adds the sole-owner bonus only when set', () => {
    expect(heatBreakdown({ ...base, isSoleOwner: true }).terms.soleOwner).toBe(HEAT_WEIGHTS.soleOwner);
    expect(heatBreakdown({ ...base, isSoleOwner: false }).terms.soleOwner).toBe(0);
  });

  it('caps the worst possible task at exactly 100', () => {
    const worst = heatScore({
      priority: 'P0',
      dueDate: '2026-01-01',
      moneyImpactCents: MONEY_SATURATION_CENTS * 100,
      blockedPeopleCount: 50,
      isSoleOwner: true,
      now: NOW,
    });
    expect(worst).toBe(100);
  });

  it('never returns a negative score', () => {
    const score = heatScore({ ...base, moneyImpactCents: -1, blockedPeopleCount: -3 });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('weights sum to 100 so the terms are directly comparable', () => {
    const sum = Object.values(HEAT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('puts an overdue P0 blocking the team above a fresh P0', () => {
    const overdue = heatScore({
      ...base, priority: 'P0', dueDate: '2026-08-20', blockedPeopleCount: 4, isSoleOwner: true,
    });
    const fresh = heatScore({ ...base, priority: 'P0' });
    expect(overdue).toBeGreaterThan(fresh);
    // Without money impact a task tops out at 80, so this lands in 'hot'.
    expect(heatBand(overdue)).toBe('hot');
  });

  it('reaches the burning band once real money is attached', () => {
    const burning = heatScore({
      ...base,
      priority: 'P0',
      dueDate: '2026-08-20',
      moneyImpactCents: 2_500_000,
      blockedPeopleCount: 4,
      isSoleOwner: true,
    });
    expect(heatBand(burning)).toBe('burning');
  });

  it('uses the documented saturation window for overdue days', () => {
    expect(OVERDUE_SATURATION_DAYS).toBe(14);
  });
});

describe('heatBand', () => {
  it('maps scores onto the cockpit bands', () => {
    expect(heatBand(90)).toBe('burning');
    expect(heatBand(75)).toBe('burning');
    expect(heatBand(60)).toBe('hot');
    expect(heatBand(30)).toBe('warm');
    expect(heatBand(10)).toBe('cool');
  });
});
