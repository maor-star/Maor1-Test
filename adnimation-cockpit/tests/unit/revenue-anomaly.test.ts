import { describe, expect, it } from 'vitest';
import {
  DROP_CRITICAL_PCT, DROP_WARNING_PCT, MIN_MATERIAL_CENTS, SPIKE_WATCH_PCT,
  baselineFor, detectAnomalies, detectAnomaly, median, type AnomalyInput,
} from '@/lib/revenue/anomaly';

/** 2026-08-28 is a Friday; 28 days of history back to 2026-07-31. */
const history = (perDay: number | ((i: number) => number), days = 28) =>
  Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 31) + i * 86_400_000);
    return {
      date: d.toISOString().slice(0, 10),
      netCents: typeof perDay === 'function' ? perDay(i) : perDay,
    };
  });

const input = (todayNet: number, hist = history(1_000_000)): AnomalyInput => ({
  scopeType: 'dept',
  scopeId: 'CORE',
  scopeLabel: 'Core Publishers',
  history: hist,
  today: { date: '2026-08-28', netCents: todayNet },
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3); // rounds the midpoint average
  });

  it('is zero for an empty series', () => {
    expect(median([])).toBe(0);
  });
});

describe('baselineFor', () => {
  it('uses the same weekday within the 28-day window', () => {
    // Weekends at half the weekday level.
    const hist = history((i) => {
      const d = new Date(Date.UTC(2026, 6, 31) + i * 86_400_000).getUTCDay();
      return d === 5 ? 400_000 : 1_000_000; // Friday is structurally lower
    });
    // 2026-08-28 is a Friday, so the baseline must be the Friday level.
    expect(baselineFor(hist, '2026-08-28')).toBe(400_000);
  });

  it('falls back to the 7-day median with too few same-weekday samples', () => {
    const short = history(800_000, 5);
    expect(baselineFor(short, '2026-08-28')).toBe(800_000);
  });

  it('ignores history older than the 28-day window', () => {
    const hist = [
      { date: '2026-01-02', netCents: 99_000_000 }, // ancient Friday
      ...history(1_000_000),
    ];
    expect(baselineFor(hist, '2026-08-28')).toBe(1_000_000);
  });
});

describe('detectAnomaly', () => {
  it('is silent on a normal day', () => {
    expect(detectAnomaly(input(1_020_000))).toBeNull();
  });

  it('warns on a drop past 20%', () => {
    const a = detectAnomaly(input(790_000));
    expect(a?.severity).toBe('warning');
    expect(a?.kind).toBe('drop');
  });

  it('does not warn just under the 20% threshold', () => {
    expect(detectAnomaly(input(Math.round(1_000_000 * (1 - DROP_WARNING_PCT + 0.01))))).toBeNull();
  });

  it('escalates a drop past 35% to critical', () => {
    const a = detectAnomaly(input(Math.round(1_000_000 * (1 - DROP_CRITICAL_PCT - 0.01))));
    expect(a?.severity).toBe('critical');
  });

  it('treats zero on a previously active scope as critical and distinct', () => {
    const a = detectAnomaly(input(0));
    expect(a?.severity).toBe('critical');
    expect(a?.kind).toBe('zeroed');
    expect(a?.recommendedAction).toContain('integration');
  });

  it('flags a spike past 60% for review', () => {
    const a = detectAnomaly(input(Math.round(1_000_000 * (1 + SPIKE_WATCH_PCT + 0.05))));
    expect(a?.severity).toBe('watch');
    expect(a?.kind).toBe('spike');
    expect(a?.whatHappened).toContain('up ');
  });

  it('does not fire on a weekend dip once the weekday adjustment applies', () => {
    const hist = history((i) => {
      const d = new Date(Date.UTC(2026, 6, 31) + i * 86_400_000).getUTCDay();
      return d === 5 ? 500_000 : 1_000_000;
    });
    // A normal Friday: half the weekday level, but exactly on its own baseline.
    expect(detectAnomaly(input(500_000, hist))).toBeNull();
  });

  it('stays quiet on a scope too small to matter', () => {
    const tiny = history(1_000); // $10/day
    expect(detectAnomaly({ ...input(0, tiny) })).toBeNull();
  });

  it('reports the money impact, not just a percentage', () => {
    const a = detectAnomaly(input(600_000));
    expect(a?.moneyImpactCents).toBe(400_000);
    expect(a?.baselineCents).toBe(1_000_000);
  });

  it('returns nothing when there is no baseline to compare against', () => {
    expect(detectAnomaly({ ...input(500_000), history: [] })).toBeNull();
  });

  it('gives every anomaly the five fields the Action Inbox needs', () => {
    const a = detectAnomaly(input(300_000));
    expect(a).toBeTruthy();
    expect(a?.whatHappened.length).toBeGreaterThan(0);
    expect(a?.recommendedAction.length).toBeGreaterThan(0);
    expect(a?.date).toBe('2026-08-28');
    expect(a?.scopeLabel).toBe('Core Publishers');
    expect(typeof a?.moneyImpactCents).toBe('number');
  });

  it('uses the documented material floor', () => {
    expect(MIN_MATERIAL_CENTS).toBe(5_000);
  });
});

describe('detectAnomalies', () => {
  it('sorts critical first, then by money at risk', () => {
    const results = detectAnomalies([
      { ...input(790_000), scopeId: 'A', scopeLabel: 'A' },
      { ...input(100_000), scopeId: 'B', scopeLabel: 'B' },
      { ...input(1_000_000), scopeId: 'C', scopeLabel: 'C' },
    ]);
    expect(results.map((r) => r.scopeId)).toEqual(['B', 'A']);
    expect(results[0]?.severity).toBe('critical');
  });

  it('returns an empty list when everything is normal', () => {
    expect(detectAnomalies([input(1_000_000)])).toEqual([]);
  });
});
