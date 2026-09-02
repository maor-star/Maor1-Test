import { describe, expect, it } from 'vitest';
import { lastCompleteDay, rankCoreClients, summariseLine, type CoreClientDay, type LineDay } from '@/lib/control/lines';

/**
 * The control panel's arithmetic, with no source underneath.
 *
 * Two rules worth holding: today is never a full day, so it never becomes the
 * headline figure; and a trend is only offered when there is a whole prior
 * week to compare against, because seven days against three reads as a boom.
 */

const day = (date: string, gross: number, line: LineDay['line'] = 'video'): LineDay => ({
  line, date, grossCents: gross, profitCents: Math.round(gross / 10), impressions: gross * 3, entities: 5,
});

const dates = (n: number, endExclusive: string) => {
  const end = new Date(`${endExclusive}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(end - (n - i) * 86_400_000).toISOString().slice(0, 10));
};

describe('the last complete day', () => {
  it('is the newest day before today, never today itself', () => {
    expect(lastCompleteDay(['2026-09-01', '2026-09-02', '2026-08-31'], '2026-09-02')).toBe('2026-09-01');
  });
  it('is nothing when the source only has today', () => {
    expect(lastCompleteDay(['2026-09-02'], '2026-09-02')).toBeNull();
  });
});

describe('one line, summarised', () => {
  const today = '2026-09-02';

  it('leads with the last full day and ignores the partial one', () => {
    const days = [...dates(14, today).map((d) => day(d, 1000)), day(today, 7)];
    const s = summariseLine('video', days, today);
    expect(s.lastDay).toBe('2026-09-01');
    expect(s.grossCents).toBe(1000);
    expect(s.gross7dCents).toBe(7000);
  });

  it('compares seven days against the seven before', () => {
    const ds = dates(14, today);
    const days = ds.map((d, i) => day(d, i < 7 ? 1000 : 1500));
    expect(summariseLine('video', days, today).trendPct).toBeCloseTo(0.5);
  });

  it('offers no trend without a full prior week', () => {
    const days = dates(9, today).map((d) => day(d, 1000));
    expect(summariseLine('video', days, today).trendPct).toBeNull();
  });

  it('calls a line stale when its last full day is more than two days old', () => {
    const fresh = summariseLine('video', dates(3, today).map((d) => day(d, 1)), today);
    const old = summariseLine('video', dates(3, '2026-08-25').map((d) => day(d, 1)), today);
    expect(fresh.stale).toBe(false);
    expect(old.stale).toBe(true);
  });

  it('only counts its own line', () => {
    const days = [...dates(7, today).map((d) => day(d, 100)), ...dates(7, today).map((d) => day(d, 900, 'apps'))];
    expect(summariseLine('video', days, today).gross7dCents).toBe(700);
  });
});

describe('the core clients', () => {
  const today = '2026-09-02';
  const client = (account: string, date: string, gross: number, isTrading = false): CoreClientDay => ({
    account, date, isTrading, grossCents: gross, profitCents: gross / 10, impressions: 1,
  });

  it('ranks on the last seven full days, biggest first', () => {
    const ds = dates(7, today);
    const rows = [...ds.map((d) => client('Small', d, 10)), ...ds.map((d) => client('Big', d, 100)), client('Big', today, 99_999)];
    const ranked = rankCoreClients(rows, today);
    expect(ranked.map((c) => c.account)).toEqual(['Big', 'Small']);
    expect(ranked[0]!.gross7dCents).toBe(700);
  });

  it('trends each account against its own previous week', () => {
    const ds = dates(14, today);
    const rows = ds.map((d, i) => client('Acme', d, i < 7 ? 200 : 100));
    expect(rankCoreClients(rows, today)[0]!.trendPct).toBeCloseTo(-0.5);
  });

  it('marks a trading account rather than hiding it', () => {
    const rows = dates(7, today).map((d) => client('Markito (Trading)', d, 50, true));
    expect(rankCoreClients(rows, today)[0]!.isTrading).toBe(true);
  });

  it('drops an account that earned nothing this week', () => {
    const rows = dates(14, today).map((d, i) => client('Gone', d, i < 7 ? 100 : 0));
    expect(rankCoreClients(rows, today)).toEqual([]);
  });
});
