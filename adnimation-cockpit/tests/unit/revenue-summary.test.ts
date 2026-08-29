import { describe, expect, it } from 'vitest';
import { buildHistory, latestCompleteDate, summariseRevenue } from '@/lib/revenue/summary';
import { toRevenueFacts } from '@/lib/revenue/normalize';
import { DEFAULT_DEPT_MAPPING } from '@/lib/revenue/mapping';
import type { ArsRow } from '@/lib/revenue/types';

const r = (date: string, category: string, trading: boolean, gross: number, fee: number, imps = 1000): ArsRow => ({
  date, category, trading, grossCents: gross, feeCents: fee, impressions: imps,
});

/** Two weeks of flat revenue in two departments, plus the day under test. */
const flat = (): ArsRow[] => {
  const rows: ArsRow[] = [];
  for (let i = 14; i >= 1; i -= 1) {
    const d = new Date(Date.UTC(2026, 7, 28) - i * 86_400_000).toISOString().slice(0, 10);
    rows.push(r(d, 'google', false, 200_000, 100_000));
    rows.push(r(d, 'video', true, 100_000, 40_000));
  }
  return rows;
};

const facts = (rows: ArsRow[]) => toRevenueFacts(rows, DEFAULT_DEPT_MAPPING);

describe('summariseRevenue', () => {
  it('totals gross and net for the day', () => {
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'google', false, 200_000, 100_000), r('2026-08-28', 'video', true, 100_000, 40_000)]),
      '2026-08-28',
    );
    expect(s.totalGrossCents).toBe(300_000);
    expect(s.totalNetCents).toBe(160_000);
    expect(s.takeRate).toBeCloseTo(160_000 / 300_000, 6);
  });

  it('sorts departments by revenue, highest first', () => {
    const s = summariseRevenue(
      facts([
        ...flat(),
        r('2026-08-28', 'google', false, 100_000, 50_000),
        r('2026-08-28', 'video', true, 900_000, 100_000),
      ]),
      '2026-08-28',
    );
    expect(s.depts.map((d) => d.deptCode)).toEqual(['VID', 'CORE']);
  });

  it('computes the three deltas the cockpit shows', () => {
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'google', false, 100_000, 50_000)]),
      '2026-08-28',
    );
    // Yesterday CORE was 200k gross / 100k net; today 100k / 50k → -50%.
    const core = s.depts.find((d) => d.deptCode === 'CORE');
    expect(core?.vsPrevDay.pct).toBeCloseTo(-0.5, 6);
    expect(core?.vsSameDayLastWeek.pct).toBeCloseTo(-0.5, 6);
    expect(core?.vsSevenDayAvg.pct).toBeCloseTo(-0.5, 6);
  });

  it('reports a null delta rather than 0% when there is no prior day', () => {
    const s = summariseRevenue(facts([r('2026-08-28', 'google', false, 100_000, 50_000)]), '2026-08-28');
    expect(s.vsPrevDay.pct).toBeNull();
    expect(s.vsSameDayLastWeek.pct).toBeNull();
  });

  it('switches the basis between net and gross', () => {
    const rows = [...flat(), r('2026-08-28', 'google', false, 400_000, 300_000)];
    const coreOn = (basis: 'net' | 'gross') =>
      summariseRevenue(facts(rows), '2026-08-28', basis).depts.find((d) => d.deptCode === 'CORE');

    // CORE yesterday: 200k gross / 100k net. Today: 400k gross / 100k net.
    // The same day is a doubling on gross and flat on net — which is exactly
    // why the spec insists the two are never conflated.
    expect(coreOn('gross')?.vsPrevDay.pct).toBeCloseTo(1, 6);
    expect(coreOn('net')?.vsPrevDay.pct).toBeCloseTo(0, 6);
    expect(summariseRevenue(facts(rows), '2026-08-28', 'net').basis).toBe('net');
  });

  it('keeps unmapped revenue in its own bucket instead of hiding it', () => {
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'brand_new_channel', false, 500_000, 100_000)]),
      '2026-08-28',
    );
    const unassigned = s.depts.find((d) => d.deptCode === null);
    expect(unassigned?.netCents).toBe(400_000);
    expect(s.totalNetCents).toBe(400_000);
  });

  it('flags that the department mapping is still unconfirmed', () => {
    const s = summariseRevenue(facts([...flat(), r('2026-08-28', 'google', false, 1, 0)]), '2026-08-28');
    expect(s.mappingNeedsReview).toBe(true);
  });

  it('produces a sparkline of the requested length', () => {
    const s = summariseRevenue(facts([...flat(), r('2026-08-28', 'google', false, 1, 0)]), '2026-08-28', 'net', 30);
    expect(s.spark).toHaveLength(30);
    expect(s.spark.at(-1)).toBe(1);
  });

  it('surfaces anomalies alongside the totals', () => {
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'google', false, 20_000, 10_000)]),
      '2026-08-28',
    );
    expect(s.anomalies.length).toBeGreaterThan(0);
    expect(s.anomalies[0]?.severity).toBe('critical');
  });

  it('carries the category breakdown for drill-down', () => {
    const s = summariseRevenue(
      facts([
        ...flat(),
        r('2026-08-28', 'google', false, 300_000, 100_000),
        r('2026-08-28', 'header_bidding', false, 100_000, 20_000),
      ]),
      '2026-08-28',
    );
    const core = s.depts.find((d) => d.deptCode === 'CORE');
    expect(core?.categories.map((c) => c.category)).toEqual(['google', 'header_bidding']);
  });
});

describe('latestCompleteDate', () => {
  it('skips today, which is always partial', () => {
    const f = facts([r('2026-08-28', 'google', false, 1, 0), r('2026-08-29', 'google', false, 1, 0)]);
    expect(latestCompleteDate(f, '2026-08-29')).toBe('2026-08-28');
  });

  it('is null when there is no complete day', () => {
    expect(latestCompleteDate(facts([r('2026-08-29', 'google', false, 1, 0)]), '2026-08-29')).toBeNull();
  });
});

describe('buildHistory', () => {
  it('excludes the day under test and sorts oldest first', () => {
    const h = buildHistory(facts([...flat(), r('2026-08-28', 'google', false, 1, 0)]), '2026-08-28');
    expect(h.at(-1)?.date).toBe('2026-08-27');
    expect(h[0]?.date).toBe('2026-08-14');
  });
});
