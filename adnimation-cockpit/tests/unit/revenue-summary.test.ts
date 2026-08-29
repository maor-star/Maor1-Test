import { describe, expect, it } from 'vitest';
import { buildHistory, latestCompleteDate, summariseRevenue } from '@/lib/revenue/summary';
import { toRevenueFacts } from '@/lib/revenue/normalize';
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

const facts = (rows: ArsRow[]) => toRevenueFacts(rows);

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
    expect(s.depts.map((d) => d.deptCode)).toEqual(['video', 'google']);
  });

  it('computes the three deltas the cockpit shows', () => {
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'google', false, 100_000, 50_000)]),
      '2026-08-28',
    );
    // Yesterday Google was 200k gross / 100k net; today 100k / 50k → -50%.
    const core = s.depts.find((d) => d.deptCode === 'google');
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
      summariseRevenue(facts(rows), '2026-08-28', basis).depts.find((d) => d.deptCode === 'google');

    // Google yesterday: 200k gross / 100k net. Today: 400k gross / 100k net.
    // The same day is a doubling on gross and flat on net — which is exactly
    // why the spec insists the two are never conflated.
    expect(coreOn('gross')?.vsPrevDay.pct).toBeCloseTo(1, 6);
    expect(coreOn('net')?.vsPrevDay.pct).toBeCloseTo(0, 6);
    expect(summariseRevenue(facts(rows), '2026-08-28', 'net').basis).toBe('net');
  });

  it('shows a category the source has just added as its own department', () => {
    // Departments are the source's categories, so a new one needs no rule and
    // cannot land in the wrong bucket — it appears under its own name.
    const s = summariseRevenue(
      facts([...flat(), r('2026-08-28', 'brand_new_channel', false, 500_000, 100_000)]),
      '2026-08-28',
    );
    const added = s.depts.find((d) => d.deptCode === 'brand_new_channel');
    expect(added?.netCents).toBe(400_000);
    expect(added?.label).toBe('BRAND NEW CHANNEL');
    expect(s.totalNetCents).toBe(400_000);
  });

  it('labels each department the way the source names it', () => {
    const s = summariseRevenue(facts([...flat(), r('2026-08-28', 'google', false, 1, 0)]), '2026-08-28');
    expect(s.depts.find((d) => d.deptCode === 'google')?.label).toBe('GOOGLE (GAM)');
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

  it('splits a department by business line for drill-down', () => {
    // One category, both business lines: the trading desk and the managed
    // publisher book are separate rows inside the same department.
    const s = summariseRevenue(
      facts([
        ...flat(),
        r('2026-08-28', 'header_bidding', false, 300_000, 100_000),
        r('2026-08-28', 'header_bidding', true, 100_000, 20_000),
      ]),
      '2026-08-28',
    );
    const hb = s.depts.find((d) => d.deptCode === 'header_bidding');
    expect(hb?.categories.map((c) => c.businessLine)).toEqual(['publisher', 'trading']);
    expect(hb?.netCents).toBe(280_000);
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
