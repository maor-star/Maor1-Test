import { describe, expect, it } from 'vitest';
import {
  CLIENT_PERIODS, concentration, isClientPeriod, loadClients, type Client,
} from '@/lib/clients/service';

/**
 * These run against the real account pull, so they check the arithmetic and
 * that the fixture still holds together.
 */

const client = (over: Partial<Client> = {}): Client => ({
  name: 'X',
  isTrading: false,
  grossCents: 0,
  netAfterFeeCents: 0,
  payoutCents: 0,
  profitCents: 0,
  impressions: 0,
  ecpmCents: null,
  takeRate: null,
  profitPerDayCents: 0,
  trendPct: null,
  ...over,
});

describe('loadClients', () => {
  it('answers every window it advertises', async () => {
    for (const p of CLIENT_PERIODS) {
      const book = await loadClients(p);
      expect(book.clients.length).toBeGreaterThan(50);
      expect(book.totals.clientCount).toBe(book.clients.length);
    }
  });

  it('sorts on profit, and that is a different order from gross', async () => {
    const { clients } = await loadClients('30D');
    const profits = clients.map((c) => c.profitCents);
    expect([...profits].sort((a, b) => b - a)).toEqual(profits);

    // Ranking by gross reorders the book, because take rates differ per client
    // — which is the whole reason the page sorts on profit.
    const byGross = [...clients].sort((a, b) => b.grossCents - a.grossCents).map((c) => c.name);
    expect(byGross).not.toEqual(clients.map((c) => c.name));
  });

  it('shows take rates that genuinely differ between clients', async () => {
    const { clients } = await loadClients('30D');
    const takes = clients
      .filter((c) => c.grossCents > 100_00 && c.takeRate !== null)
      .map((c) => c.takeRate!);
    expect(takes.length).toBeGreaterThan(10);
    expect(Math.max(...takes) - Math.min(...takes)).toBeGreaterThan(0.05);
  });

  it('never reports a profit above gross', async () => {
    const { clients } = await loadClients('30D');
    for (const c of clients) expect(c.profitCents).toBeLessThanOrEqual(c.grossCents);
  });

  it('keeps the payout and the profit adding up to what came in after the fee', async () => {
    const { clients } = await loadClients('30D');
    for (const c of clients) expect(c.payoutCents + c.profitCents).toBe(c.netAfterFeeCents);
  });

  it('totals match the sum of the rows', async () => {
    const book = await loadClients('7D');
    expect(book.totals.profitCents).toBe(book.clients.reduce((a, c) => a + c.profitCents, 0));
    expect(book.totals.grossCents).toBe(book.clients.reduce((a, c) => a + c.grossCents, 0));
  });

  it('scales a window to a daily rate', async () => {
    const [day, week] = await Promise.all([loadClients('YESTERDAY'), loadClients('7D')]);
    expect(day.windowDays).toBe(1);
    expect(week.windowDays).toBe(7);
    const top = week.clients[0]!;
    expect(top.profitPerDayCents).toBe(Math.round(top.profitCents / 7));
  });

  it('compares a short window against the 30-day run rate, and 30D against nothing', async () => {
    const week = await loadClients('7D');
    expect(week.clients.some((c) => c.trendPct !== null)).toBe(true);

    // A 30-day window compared against itself is not a trend, it is zero.
    const month = await loadClients('30D');
    expect(month.clients.every((c) => c.trendPct === null)).toBe(true);
  });

  it('validates a period string from the URL', () => {
    expect(isClientPeriod('7D')).toBe(true);
    expect(isClientPeriod('YTD')).toBe(false);
    expect(isClientPeriod(undefined)).toBe(false);
  });
});

describe('concentration', () => {
  it('measures how much of profit sits in the top N', () => {
    const clients = [80, 10, 5, 5].map((n) => client({ profitCents: n }));
    expect(concentration(clients, 1)).toBeCloseTo(0.8);
    expect(concentration(clients, 2)).toBeCloseTo(0.9);
  });

  it('is null when there is no profit to divide', () => {
    expect(concentration([], 5)).toBeNull();
    expect(concentration([client({ profitCents: 0 })], 5)).toBeNull();
  });

  it('reaches 1 when asked for more clients than exist', () => {
    expect(concentration([client({ profitCents: 10 })], 5)).toBe(1);
  });

  it('reports a real, material concentration on the live book', async () => {
    const { clients } = await loadClients('30D');
    const top5 = concentration(clients, 5);
    expect(top5).not.toBeNull();
    expect(top5!).toBeGreaterThan(0);
    expect(top5!).toBeLessThanOrEqual(1);
  });
});
