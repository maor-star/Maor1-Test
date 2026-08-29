import { describe, expect, it } from 'vitest';
import {
  DEAD_REVENUE_PER_M_CENTS, TRADING_PERIODS, loadTrading,
} from '@/lib/trading/service';

/**
 * The trading desk's arithmetic, against the real snapshot.
 *
 * The point of these is the two places the module could quietly lie: totals
 * taken from the ranked rows rather than the exchange's own accounting, and a
 * margin computed against the wrong denominator.
 */
describe('trading', () => {
  it('offers both windows', () => {
    expect([...TRADING_PERIODS]).toEqual(['YESTERDAY', '7D']);
  });

  it('takes totals from the daily accounting, not from the ranked rows', async () => {
    const view = await loadTrading('YESTERDAY');
    const rankedProfit = view.bundles.reduce((a, b) => a + b.profitCents, 0);

    expect(view.days).toBe(1);
    // The ranked rows are a top list; the day made more than they account for.
    expect(view.totals.profitCents).toBeGreaterThan(rankedProfit);
    expect(view.totals.profitCents).toBe(138_241);
  });

  it('sums the seven-day window across its chunks', async () => {
    const week = await loadTrading('7D');
    expect(week.days).toBe(7);
    expect(week.from).toBe('2026-08-22');
    expect(week.to).toBe('2026-08-28');

    const day = await loadTrading('YESTERDAY');
    expect(week.totals.profitCents).toBeGreaterThan(day.totals.profitCents);
  });

  it('ranks bundles by profit and keeps both sides of each trade', async () => {
    const view = await loadTrading('7D');
    const top = view.bundles[0]!;

    for (let i = 1; i < view.bundles.length; i += 1) {
      expect(view.bundles[i - 1]!.profitCents).toBeGreaterThanOrEqual(view.bundles[i]!.profitCents);
    }

    expect(top.sellers.length).toBeGreaterThan(0);
    expect(top.buyers.length).toBeGreaterThan(0);
    expect(top.topRoute.sellerEndpoint).not.toBe('');
    expect(top.topRoute.buyerEndpoint).not.toBe('');
  });

  it('computes margin against revenue, so it stays under 100%', async () => {
    const view = await loadTrading('7D');
    for (const b of view.bundles) {
      expect(b.marginPct).toBeGreaterThan(0);
      expect(b.marginPct).toBeLessThan(100);
      // The source rounds revenue, cost and profit independently to the cent,
      // so a bundle folded from several rows can differ by a few cents. What
      // must hold is that profit is the gap between the two, not a third figure.
      expect(Math.abs(b.revenueCents - b.costCents - b.profitCents)).toBeLessThanOrEqual(10);
    }
  });

  it('a bundle sold by two partners folds into one row, not two', async () => {
    const view = await loadTrading('7D');
    const names = view.bundles.map((b) => b.bundle);
    expect(new Set(names).size).toBe(names.length);

    const arrow = view.bundles.find((b) => b.bundle === 'com.arrow.out')!;
    expect(arrow.sellers.length).toBeGreaterThan(1);
    expect(arrow.routes).toBeGreaterThan(1);
  });

  it('flags supply pouring requests into demand that does not buy', async () => {
    const view = await loadTrading('YESTERDAY');
    const dead = view.waste.rows.filter((r) => r.dead);

    expect(dead.length).toBeGreaterThan(0);
    for (const row of dead) {
      expect(row.revenuePerMillionCents).toBeLessThan(DEAD_REVENUE_PER_M_CENTS);
    }

    // The worst offender is a real one: tens of millions of requests, cents back.
    const gravite = view.waste.rows.find(
      (r) => r.sellerCompany === 'IQzone' && r.buyerCompany === 'Gravite',
    )!;
    expect(gravite.dead).toBe(true);
    expect(gravite.requests).toBeGreaterThan(40_000_000);
    expect(gravite.revenueCents).toBeLessThan(100);

    // A path that is buying properly is not flagged.
    const working = view.waste.rows.find(
      (r) => r.sellerCompany === 'PubNative' && r.buyerCompany === 'Sovrn SM',
    )!;
    expect(working.dead).toBe(false);
  });

  it('sorts the waste board by request volume, which is what it costs', async () => {
    const view = await loadTrading('YESTERDAY');
    for (let i = 1; i < view.waste.rows.length; i += 1) {
      expect(view.waste.rows[i - 1]!.requests).toBeGreaterThanOrEqual(view.waste.rows[i]!.requests);
    }
    expect(view.waste.deadRequests).toBeLessThanOrEqual(view.waste.totalRequests);
  });
});
